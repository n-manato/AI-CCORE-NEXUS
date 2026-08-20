import { NextResponse } from "next/server";
import {
  gateRequest,
  gatewayError,
  corsHeaders,
  recordUsage,
  isTimeoutError,
  errorStatus,
} from "@/lib/gateway";

export const dynamic = "force-dynamic";

const PATH = "/v1/motion/stream";
const MODEL = "actionplan-1";

// TEXT->motion streaming co-speech gesture (ActionPlan, resident on GPU1).
// Proxies the sidecar's NDJSON stream back unbuffered, so the first motion
// frames reach the app ~0.35s after the LLM sentence text arrives — no TTS
// audio needed (unlike /v1/gesture, which waits for the synthesized speech).
// Body: {"text","seconds","session","chain"} — forwarded verbatim.
// skipModelLease: the ActionPlan service manages its own VRAM (always resident,
// same pattern as vLLM on /v1/chat/completions).
const AP_URL = process.env.ACTIONPLAN_URL ?? "http://127.0.0.1:8893/motion/stream";

export async function POST(req: Request) {
  const t0 = Date.now();
  const gate = await gateRequest(req, PATH, MODEL, { skipModelLease: true });
  if (!gate.ok) return gate.response;
  const usage = {
    userId: gate.auth.userId,
    apiName: gate.apiName,
    category: gate.category,
    path: PATH,
  };

  let body: string;
  try {
    body = await req.text();
  } catch {
    gate.release();
    return gatewayError("bad_request", { detail: "JSON body required" });
  }

  let upstream: Response;
  try {
    upstream = await fetch(AP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // identity => every NDJSON line flushes to us the moment the sidecar
        // emits it instead of being buffered for compression.
        "Accept-Encoding": "identity",
      },
      body,
      signal: req.signal,
    });
  } catch (e) {
    gate.release();
    const key = isTimeoutError(e) ? "backend_timeout" : "backend_error";
    const message = (e as Error)?.message;
    await recordUsage({ ...usage, isError: true, model: MODEL, code: key, status: errorStatus(key), message, stream: true });
    return gatewayError(key, message ? { detail: message } : undefined);
  }
  if (!upstream.ok || !upstream.body) {
    gate.release();
    const errBody = await upstream.text().catch(() => "");
    const message = errBody.slice(0, 200);
    await recordUsage({ ...usage, isError: true, model: MODEL, code: "backend_error", status: errorStatus("backend_error"), message, stream: true });
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
        /* upstream error / abort */
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
  void recordUsage({ ...usage, isError: false, latencyMs: Date.now() - t0, model: MODEL, status: 200, stream: true });

  return new Response(passthrough, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      ...corsHeaders(req.headers.get("origin")),
    },
  });
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
