import { NextResponse } from "next/server";
import { z } from "zod";
import {
  gateRequest,
  gatewayError,
  corsHeaders,
  recordUsage,
  classifyBackendError,
  extractUpstreamMessage,
  isTimeoutError,
  errorStatus,
} from "@/lib/gateway";
import { activeBackend } from "@/lib/backends";
import { appIdToTag, toAppId, ollamaHasTag, ollamaChatStream, OllamaError } from "@/lib/ollama";
import { logGatewayError } from "@/lib/gateway-log";
import { maybeCompactMessages } from "@/lib/context/transparent";
import type { ChatMsg } from "@/lib/context/tokens";

export const dynamic = "force-dynamic";

// Permissive, OpenAI-compatible body. Real clients (Cline, the OpenAI SDK, etc.)
// send richer payloads than a minimal schema allows: message `content` can be a
// string, an array of content parts, or null (assistant tool turns); roles can
// be system/user/assistant/tool/developer; and extra params (temperature,
// top_p, tools, stream_options, ...) must pass through untouched. We only
// require a model and a non-empty messages array; everything else is forwarded.
const Body = z
  .object({
    model: z.string().min(1),
    messages: z.array(z.record(z.string(), z.any())).min(1),
    stream: z.boolean().optional(),
  })
  .passthrough();

const PATH = "/v1/chat/completions";

// vLLM (externally-managed, OpenAI-compatible) models are routed straight to the
// local vLLM server instead of Ollama. The gateway does NOT manage vLLM's VRAM /
// loading (it's run out-of-band), so these skip the model VRAM lease; auth +
// category access + concurrency accounting still apply. Comma-separated ids in
// VLLM_MODELS; VLLM_URL points at the vLLM OpenAI endpoint (default localhost).
const VLLM_MODELS = new Set(
  (process.env.VLLM_MODELS ?? "qwen3-30b-a3b")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const VLLM_URL = process.env.VLLM_URL ?? "http://127.0.0.1:8807/v1/chat/completions";

// Some chat templates (Mistral / Devstral) STRICTLY require user/assistant roles
// to alternate and raise a Jinja exception otherwise. Agents like Cline often
// send consecutive same-role messages (e.g. two user turns) → Ollama returns 500
// → the gate surfaces 502. Merge consecutive plain-text messages of the same
// role so strict templates accept the conversation. Tool calls / tool results
// and non-string (multimodal) content are left untouched — templates allow those
// to break alternation. Harmless for lenient templates (Qwen etc.).
function normalizeMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  // Flatten an all-text content array (OpenAI "parts" form) into a single
  // string. Cline sends user content as MULTIPLE text parts; strict templates
  // (Mistral/Devstral) raise a Jinja exception on multi-part arrays. Arrays that
  // contain any non-text part (e.g. images) are left intact to preserve vision.
  const flatten = (content: unknown): unknown => {
    if (!Array.isArray(content)) return content;
    const parts = content as Array<Record<string, unknown>>;
    if (parts.length > 0 && parts.every((p) => p && p.type === "text" && typeof p.text === "string")) {
      return parts.map((p) => p.text as string).join("\n");
    }
    return content;
  };
  const mergeable = (m: Record<string, unknown>): boolean =>
    typeof m.content === "string" &&
    !("tool_calls" in m) &&
    !("tool_call_id" in m) &&
    (m.role === "system" || m.role === "user" || m.role === "assistant");
  const out: Record<string, unknown>[] = [];
  for (const raw of messages as Record<string, unknown>[]) {
    const m: Record<string, unknown> = { ...raw, content: flatten(raw.content) };
    const prev = out[out.length - 1];
    if (prev && mergeable(prev) && mergeable(m) && prev.role === m.role) {
      prev.content = `${prev.content as string}\n\n${m.content as string}`;
    } else {
      out.push(m);
    }
  }
  return out;
}

// POST /v1/chat/completions - OpenAI-compatible chat completion (Ollama-backed),
// with streaming (SSE) passthrough when the client requests stream: true. The
// gate enforces enablement/concurrency against the SPECIFIC requested model.
export async function POST(req: Request) {
  const t0 = Date.now();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const requestedModel = parsed.success ? toAppId(parsed.data.model) : undefined;
  const isVllm = parsed.success && VLLM_MODELS.has(parsed.data.model);

  const gate = await gateRequest(req, PATH, requestedModel, { skipModelLease: isVllm });
  if (!gate.ok) return gate.response;
  const usage = { userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, path: PATH };

  if (!parsed.success) {
    gate.release();
    await recordUsage({ ...usage, isError: true, code: "bad_request", status: errorStatus("bad_request") });
    return gatewayError("bad_request");
  }
  const body = parsed.data as Record<string, unknown> & { model: string; stream?: boolean };
  body.messages = normalizeMessages(body.messages);

  // vLLM passthrough (OpenAI-compatible): pipe the request to the local vLLM server
  // and stream/return its response verbatim. No Ollama tag mapping or compaction —
  // vLLM manages its own context. release() fires on stream end / abort / cancel.
  if (isVllm) {
    let upstream: Response;
    try {
      upstream = await fetch(VLLM_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (e) {
      gate.release();
      const key = isTimeoutError(e) ? "backend_timeout" : "backend_error";
      const message = (e as Error)?.message;
      await recordUsage({ ...usage, isError: true, model: body.model, code: key, status: errorStatus(key), message, stream: !!body.stream });
      logGatewayError({ path: PATH, apiName: gate.apiName, model: body.model, code: key, status: errorStatus(key), message, stream: !!body.stream });
      return gatewayError(key, message ? { detail: message } : undefined);
    }
    if (!upstream.ok || !upstream.body) {
      gate.release();
      const errBody = await upstream.text().catch(() => "");
      const message = extractUpstreamMessage(errBody) ?? errBody.slice(0, 200);
      await recordUsage({ ...usage, isError: true, model: body.model, code: "backend_error", status: errorStatus("backend_error"), message, stream: !!body.stream });
      logGatewayError({ path: PATH, apiName: gate.apiName, model: body.model, code: "backend_error", status: errorStatus("backend_error"), upstreamStatus: upstream.status, message, stream: !!body.stream });
      return gatewayError("backend_error", message ? { detail: message } : undefined);
    }
    const release = gate.release;
    const reader = upstream.body.getReader();
    const passthrough = new ReadableStream({
      async start(controller) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch {
          /* upstream error/abort */
        } finally {
          release();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
      cancel(reason) {
        release();
        void reader.cancel(reason).catch(() => {});
      },
    });
    req.signal?.addEventListener("abort", release, { once: true });
    void recordUsage({ ...usage, isError: false, latencyMs: Date.now() - t0, model: body.model, status: 200, stream: !!body.stream });
    return new Response(passthrough, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? (body.stream ? "text/event-stream; charset=utf-8" : "application/json"),
        "Cache-Control": "no-cache, no-transform",
        ...corsHeaders(req.headers.get("origin")),
      },
    });
  }

  const tag = appIdToTag(body.model) ?? body.model;

  // Opt-in transparent compaction: when enabled (header `x-nexus-compact: on` or
  // env NEXUS_AUTOCOMPACT=on) and the incoming messages would overflow the model,
  // fold the older middle into a summary so the request fits instead of 400/502.
  // Off by default so existing clients (which manage their own context) are
  // untouched. Tool_call/result pairs are preserved (see transparent.ts).
  const compactOn = (req.headers.get("x-nexus-compact") ?? process.env.NEXUS_AUTOCOMPACT ?? "off") === "on";
  if (compactOn && Array.isArray(body.messages)) {
    try {
      const c = await maybeCompactMessages({
        messages: body.messages as ChatMsg[],
        model: toAppId(body.model),
        tag,
      });
      if (c.compacted) body.messages = c.messages;
    } catch (e) {
      logGatewayError({ path: PATH, model: body.model, code: "compact_skipped", status: 200, message: (e as Error)?.message });
    }
  }

  // Streaming passthrough: pipe Ollama's SSE straight back to the client.
  if (body.stream === true && (await ollamaHasTag(tag))) {
    let upstream: Response;
    try {
      upstream = await ollamaChatStream(tag, body);
    } catch (e) {
      gate.release();
      const key = isTimeoutError(e) ? "backend_timeout" : "backend_error";
      const message = (e as Error)?.message;
      await recordUsage({ ...usage, isError: true, model: body.model, code: key, status: errorStatus(key), message, stream: true });
      logGatewayError({ path: PATH, apiName: gate.apiName, model: body.model, code: key, status: errorStatus(key), message, stream: true });
      return gatewayError(key, message ? { detail: message } : undefined);
    }
    if (!upstream.ok || !upstream.body) {
      gate.release();
      const errBody = await upstream.text().catch(() => "");
      const { key, detail } = classifyBackendError(upstream.status, errBody);
      const message = detail ?? extractUpstreamMessage(errBody);
      await recordUsage({ ...usage, isError: true, model: body.model, code: key, status: errorStatus(key), message, stream: true });
      logGatewayError({
        path: PATH,
        apiName: gate.apiName,
        model: body.model,
        code: key,
        status: errorStatus(key),
        upstreamStatus: upstream.status,
        message,
        stream: true,
      });
      return gatewayError(key, detail ? { detail } : undefined);
    }
    // Pipe Ollama's SSE to the client, injecting a periodic SSE keep-alive
    // comment while the upstream is quiet. Ollama buffers tool_call argument
    // generation (and prefill of a large prompt) and sends NO bytes during it;
    // on a slow model a big file's tool_call can exceed an upstream proxy's
    // (e.g. Cloudflare ~100s) idle timeout → the stream is cut → Cline gets a
    // truncated tool_call ("missing content") or a 524. A ": keep-alive" comment
    // (ignored by SSE clients) every 15s keeps the connection active so large
    // tool calls complete. release() is idempotent; we release on stream end,
    // client abort, and cancel so the concurrency slot never leaks.
    const release = gate.release;
    const reader = upstream.body.getReader();
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Idle-only heartbeat: fire ONLY after 15s with no upstream bytes, reset
        // on every chunk. This guarantees the ": keep-alive" comment is never
        // spliced into the middle of an in-flight SSE data frame (which would
        // corrupt it → Cline "unparsable response"); Ollama pauses only at
        // complete event boundaries (the tool_call buffering gap), so a ping
        // during true silence always lands cleanly between events.
        let ka: ReturnType<typeof setTimeout> | undefined;
        const arm = () => {
          ka = setTimeout(() => {
            try {
              controller.enqueue(enc.encode(": keep-alive\n\n"));
            } catch {
              /* controller closed */
            }
            arm();
          }, 15_000);
        };
        arm();
        (async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (ka) clearTimeout(ka);
              controller.enqueue(value);
              arm();
            }
          } catch {
            /* upstream error/abort */
          } finally {
            if (ka) clearTimeout(ka);
            release();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        })();
      },
      cancel(reason) {
        release();
        void reader.cancel(reason).catch(() => {});
      },
    });
    req.signal?.addEventListener("abort", release, { once: true });
    void recordUsage({ ...usage, isError: false, latencyMs: Date.now() - t0, model: body.model, status: 200, stream: true });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...corsHeaders(req.headers.get("origin")),
      },
    });
  }

  // Non-streaming.
  try {
    const result = await activeBackend.chatCompletion(body as never);
    await recordUsage({ ...usage, isError: false, latencyMs: Date.now() - t0, model: body.model, status: 200 });
    return NextResponse.json(result, { headers: corsHeaders(req.headers.get("origin")) });
  } catch (e) {
    const { key, detail } =
      e instanceof OllamaError
        ? classifyBackendError(e.status, e.body)
        : { key: isTimeoutError(e) ? ("backend_timeout" as const) : ("backend_error" as const), detail: (e as Error)?.message };
    await recordUsage({ ...usage, isError: true, model: body.model, code: key, status: errorStatus(key), message: detail });
    logGatewayError({
      path: PATH,
      apiName: gate.apiName,
      model: body.model,
      code: key,
      status: errorStatus(key),
      upstreamStatus: e instanceof OllamaError ? e.status : undefined,
      message: detail,
      stream: false,
    });
    return gatewayError(key, detail ? { detail } : undefined);
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
