import { NextResponse } from "next/server";
import {
  gateRequest,
  gatewayError,
  corsHeaders,
  recordUsage,
  isTimeoutError,
  errorStatus,
} from "@/lib/gateway";
import { startTtsService } from "@/lib/tts-process";
import { TTS_MODEL_ID } from "@/lib/tts";

export const dynamic = "force-dynamic";

const PATH = "/v1/audio/stream";

// Low-latency streaming TTS: proxies GPT-SoVITS (:9880) /tts and pipes its raw
// PCM chunks straight back AS THEY ARE SYNTHESIZED. The non-streaming route
// (/v1/audio/speech) goes through voice_service (:9881), which applies the RVC
// voice in-process and therefore needs the COMPLETE waveform — it cannot stream.
// The RemGSV weights loaded in GPT-SoVITS already produce the Rem voice, so the
// streaming path skips RVC for zero-buffer, first-chunk-in-~1s playback. Override
// the GPT-SoVITS host with GSV_URL.
const GSV_URL = process.env.GSV_URL ?? "http://127.0.0.1:9880/tts";

// GET /v1/audio/stream?text=...&streaming_mode=true&media_type=raw&text_lang=ja&...
//
// Thin authenticated streaming proxy. The client (the desktop app's gsv_stream.py)
// owns EVERY GPT-SoVITS param (streaming_mode, media_type=raw, cut method, ref
// audio, sampler) via the query string; this route forwards them verbatim and
// streams the response body with no buffering. gateRequest gives the same TTS
// gate + gpt-sovits VRAM lease as the non-streaming route; release() fires on
// stream end / client abort / cancel so the lease + concurrency slot never leak.
export async function GET(req: Request) {
  const t0 = Date.now();
  const url = new URL(req.url);

  const gate = await gateRequest(req, PATH, TTS_MODEL_ID);
  if (!gate.ok) return gate.response;
  const usage = {
    userId: gate.auth.userId,
    apiName: gate.apiName,
    category: gate.category,
    path: PATH,
  };

  // On Demand: bring the voice stack (GPT-SoVITS :9880) up if it is not already.
  await startTtsService();

  const target = `${GSV_URL}?${url.searchParams.toString()}`;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "GET",
      // identity => GPT-SoVITS does not gzip the response, so each PCM fragment
      // flushes to us the moment it is synthesized instead of being buffered.
      headers: { "Accept-Encoding": "identity" },
      signal: req.signal,
    });
  } catch (e) {
    gate.release();
    const key = isTimeoutError(e) ? "backend_timeout" : "backend_error";
    const message = (e as Error)?.message;
    await recordUsage({ ...usage, isError: true, model: TTS_MODEL_ID, code: key, status: errorStatus(key), message, stream: true });
    return gatewayError(key, message ? { detail: message } : undefined);
  }
  if (!upstream.ok || !upstream.body) {
    gate.release();
    const errBody = await upstream.text().catch(() => "");
    const message = errBody.slice(0, 200);
    await recordUsage({ ...usage, isError: true, model: TTS_MODEL_ID, code: "backend_error", status: errorStatus("backend_error"), message, stream: true });
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
  void recordUsage({ ...usage, isError: false, latencyMs: Date.now() - t0, model: TTS_MODEL_ID, status: 200, stream: true });

  return new Response(passthrough, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "no-cache, no-transform",
      ...corsHeaders(req.headers.get("origin")),
    },
  });
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
