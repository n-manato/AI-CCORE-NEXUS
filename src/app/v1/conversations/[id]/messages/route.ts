import { NextResponse } from "next/server";
import { z } from "zod";
import {
  gateRequest,
  gatewayError,
  corsHeaders,
  recordUsage,
  classifyBackendError,
  isTimeoutError,
  errorStatus,
} from "@/lib/gateway";
import { logGatewayError } from "@/lib/gateway-log";
import { appIdToTag, toAppId, ollamaChat, ollamaChatStream, OllamaError } from "@/lib/ollama";
import { getConversation, addMessage } from "@/lib/context/store";
import { buildContext } from "@/lib/context/builder";
import { maybeCompact } from "@/lib/context/compactor";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    content: z.string().min(1),
    model: z.string().optional(),
    system: z.string().optional(),
    stream: z.boolean().optional(),
    options: z.record(z.string(), z.any()).optional(),
  })
  .passthrough();

// We reuse the LLM Chat gate (auth, access, maintenance, model enable, concurrency).
const GATE_PATH = "/v1/chat/completions";
const DEFAULT_MODEL = "qwen3-coder-next";

// POST /v1/conversations/:id/messages — the context-managed turn.
//
//   build budgeted context  ->  call Ollama  ->  store user+assistant  ->  auto-compact
//
// The client sends ONLY the new user message; the server owns the history and
// decides what the model actually sees (system + memory + summary + retrieval +
// recent + current), never exceeding the model's token budget.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t0 = Date.now();
  const { id } = await params;

  const conv = await getConversation(id);
  if (!conv) return gatewayError("not_found");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return gatewayError("bad_request");
  const body = parsed.data;

  const appId = toAppId(body.model ?? conv.model ?? DEFAULT_MODEL);
  const gate = await gateRequest(req, GATE_PATH, appId);
  if (!gate.ok) return gate.response;

  // Ownership: only the conversation owner (or an admin) may post to it.
  if (conv.userId !== gate.auth.userId && gate.auth.userRole !== "admin") {
    gate.release();
    return gatewayError("access_denied");
  }

  const usage = { userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, model: appId, path: GATE_PATH };
  const tag = appIdToTag(appId) ?? appId;

  // Build the budgeted context BEFORE storing the new user turn (so the builder's
  // "recent messages" are the prior turns; the new input is appended as current).
  let built;
  try {
    built = await buildContext({
      conversationId: id,
      userId: conv.userId,
      model: appId,
      systemPrompt: body.system,
      currentInput: body.content,
    });
  } catch (e) {
    gate.release();
    await recordUsage({ ...usage, isError: true, code: "internal", status: errorStatus("internal"), message: (e as Error)?.message });
    return gatewayError("internal", { detail: (e as Error)?.message });
  }

  // Persist the user turn now (survives a mid-stream disconnect).
  await addMessage({ conversationId: id, role: "user", content: body.content });

  const ollamaBody: Record<string, unknown> = {
    messages: built.messages,
    ...(body.options ? { options: body.options } : {}),
  };

  const ctxHeaders = {
    ...corsHeaders(req.headers.get("origin")),
    "x-nexus-context-tokens": String(built.estTokens),
    "x-nexus-context-budget": String(built.breakdown.budget ?? 0),
  };

  // ---- streaming ----
  if (body.stream === true) {
    let upstream: Response;
    try {
      upstream = await ollamaChatStream(tag, ollamaBody);
    } catch (e) {
      gate.release();
      const key = isTimeoutError(e) ? "backend_timeout" : "backend_error";
      const message = (e as Error)?.message;
      await recordUsage({ ...usage, isError: true, code: key, status: errorStatus(key), message, stream: true });
      logGatewayError({ path: GATE_PATH, apiName: gate.apiName, model: appId, code: key, status: errorStatus(key), message, stream: true });
      return gatewayError(key, { detail: message });
    }
    if (!upstream.ok || !upstream.body) {
      gate.release();
      const errBody = await upstream.text().catch(() => "");
      const { key, detail } = classifyBackendError(upstream.status, errBody);
      await recordUsage({ ...usage, isError: true, code: key, status: errorStatus(key), message: detail, stream: true });
      logGatewayError({ path: GATE_PATH, apiName: gate.apiName, model: appId, code: key, status: errorStatus(key), upstreamStatus: upstream.status, message: detail, stream: true });
      return gatewayError(key, detail ? { detail } : undefined);
    }

    const reader = upstream.body.getReader();
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    let assistantText = "";
    let sseBuf = "";
    const release = gate.release;

    const persist = async () => {
      if (assistantText.trim()) {
        await addMessage({ conversationId: id, role: "assistant", content: assistantText });
      }
      // Compact for the NEXT turn once this one is on disk.
      await maybeCompact({ conversationId: id, model: tag, timestamp: new Date().toISOString() }).catch(() => {});
    };

    const stream = new ReadableStream({
      start(controller) {
        let ka: ReturnType<typeof setTimeout> | undefined;
        const arm = () => {
          ka = setTimeout(() => {
            try {
              controller.enqueue(enc.encode(": keep-alive\n\n"));
            } catch {
              /* closed */
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
              // Tee: accumulate assistant text from the SSE deltas for storage.
              sseBuf += dec.decode(value, { stream: true });
              const lines = sseBuf.split("\n");
              sseBuf = lines.pop() ?? "";
              for (const line of lines) {
                const t = line.trim();
                if (!t.startsWith("data:")) continue;
                const data = t.slice(5).trim();
                if (data === "[DONE]") continue;
                try {
                  const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
                  const piece = j.choices?.[0]?.delta?.content;
                  if (piece) assistantText += piece;
                } catch {
                  /* partial/non-JSON line */
                }
              }
              arm();
            }
          } catch {
            /* upstream error/abort */
          } finally {
            if (ka) clearTimeout(ka);
            await persist().catch(() => {});
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
    void recordUsage({ ...usage, isError: false, latencyMs: Date.now() - t0, status: 200, stream: true });
    return new Response(stream, {
      status: 200,
      headers: { ...ctxHeaders, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
    });
  }

  // ---- non-streaming ----
  try {
    const result = (await ollamaChat(tag, ollamaBody)) as {
      choices?: { message?: { content?: string } }[];
    };
    const replyText = result.choices?.[0]?.message?.content ?? "";
    await addMessage({ conversationId: id, role: "assistant", content: replyText });
    await maybeCompact({ conversationId: id, model: tag, timestamp: new Date().toISOString() }).catch(() => {});
    await recordUsage({ ...usage, isError: false, latencyMs: Date.now() - t0, status: 200 });
    return NextResponse.json(result, { headers: ctxHeaders });
  } catch (e) {
    const { key, detail } =
      e instanceof OllamaError
        ? classifyBackendError(e.status, e.body)
        : { key: isTimeoutError(e) ? ("backend_timeout" as const) : ("backend_error" as const), detail: (e as Error)?.message };
    await recordUsage({ ...usage, isError: true, code: key, status: errorStatus(key), message: detail });
    logGatewayError({ path: GATE_PATH, apiName: gate.apiName, model: appId, code: key, status: errorStatus(key), upstreamStatus: e instanceof OllamaError ? e.status : undefined, message: detail, stream: false });
    return gatewayError(key, detail ? { detail } : undefined);
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
