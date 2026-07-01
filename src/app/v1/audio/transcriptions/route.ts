import { NextResponse } from "next/server";
import { gateRequest, gatewayError, corsHeaders, recordUsage } from "@/lib/gateway";
import { sidecarHealth, sidecarStt } from "@/lib/sidecar";

export const dynamic = "force-dynamic";
const PATH = "/v1/audio/transcriptions";

// POST /v1/audio/transcriptions - speech to text (sidecar faster-whisper).
// multipart/form-data with an audio `file` (+ optional `model`). Audio not stored.
export async function POST(req: Request) {
  const t0 = Date.now();
  const gate = await gateRequest(req, PATH);
  if (!gate.ok) return gate.response;
  try {
    const fd = await req.formData().catch(() => null);
    const file = fd?.get("file");
    const model = (fd?.get("model") as string) || undefined;
    if (!file || typeof file === "string") {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true });
      return gatewayError("bad_request");
    }
    const health = await sidecarHealth();
    if (health?.capabilities.stt) {
      try {
        const buf = Buffer.from(await (file as File).arrayBuffer());
        const result = await sidecarStt(buf, model);
        await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, latencyMs: Date.now() - t0 });
        return NextResponse.json(result, { headers: corsHeaders(req.headers.get("origin")) });
      } catch {
        await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true });
        return gatewayError("backend_error");
      }
    }
    await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false });
    return NextResponse.json(
      { text: "Mock transcription. Start the sidecar (faster-whisper) to enable real STT." },
      { headers: corsHeaders(req.headers.get("origin")) },
    );
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
