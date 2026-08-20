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

const PATH = "/v1/audio/weights";
const GSV_BASE = process.env.GSV_BASE ?? "http://127.0.0.1:9880";

// GET /v1/audio/weights?gpt_weights=...&sovits_weights=...
//
// Hot-swaps the fine-tuned weights loaded in the shared GPT-SoVITS server
// (api_v2 /set_gpt_weights + /set_sovits_weights) so each app character can
// bring its own voice (RemGSV / EDIGSV) without restarting the stack. Paths
// are relative to the GPT-SoVITS repo on this machine; api_v2 validates them.
// Loading takes a few seconds per file; callers should treat this as slow.
export async function GET(req: Request) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const gpt = url.searchParams.get("gpt_weights");
  const sovits = url.searchParams.get("sovits_weights");
  if (!gpt && !sovits) {
    return NextResponse.json(
      { error: "gpt_weights and/or sovits_weights query param required" },
      { status: 400, headers: corsHeaders(req.headers.get("origin")) },
    );
  }

  const gate = await gateRequest(req, PATH, TTS_MODEL_ID);
  if (!gate.ok) return gate.response;
  const usage = {
    userId: gate.auth.userId,
    apiName: gate.apiName,
    category: gate.category,
    path: PATH,
  };

  try {
    // On Demand: bring the voice stack up first if needed.
    await startTtsService();
    const loaded: Record<string, string> = {};
    if (sovits) {
      const r = await fetch(
        `${GSV_BASE}/set_sovits_weights?weights_path=${encodeURIComponent(sovits)}`,
      );
      if (!r.ok)
        throw new Error(
          `set_sovits_weights ${r.status}: ${(await r.text()).slice(0, 150)}`,
        );
      loaded.sovits = sovits;
    }
    if (gpt) {
      const r = await fetch(
        `${GSV_BASE}/set_gpt_weights?weights_path=${encodeURIComponent(gpt)}`,
      );
      if (!r.ok)
        throw new Error(
          `set_gpt_weights ${r.status}: ${(await r.text()).slice(0, 150)}`,
        );
      loaded.gpt = gpt;
    }
    void recordUsage({
      ...usage,
      isError: false,
      latencyMs: Date.now() - t0,
      model: TTS_MODEL_ID,
      status: 200,
    });
    return NextResponse.json(
      { ok: true, loaded },
      { headers: corsHeaders(req.headers.get("origin")) },
    );
  } catch (e) {
    const key = isTimeoutError(e) ? "backend_timeout" : "backend_error";
    const message = (e as Error)?.message;
    await recordUsage({
      ...usage,
      isError: true,
      model: TTS_MODEL_ID,
      code: key,
      status: errorStatus(key),
      message,
    });
    return gatewayError(key, message ? { detail: message } : undefined);
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}
