import { NextResponse } from "next/server";
import { gateRequest, gatewayError, corsHeaders, recordUsage, isTimeoutError } from "@/lib/gateway";
import { gestureHealth, gestureGenerate } from "@/lib/gesture";

export const dynamic = "force-dynamic";

const PATH = "/v1/gesture";
const MODEL = "gesturelsm-1";

// POST /v1/gesture - co-speech gesture from the assistant's spoken audio (+text).
// multipart/form-data: audio=<wav>, text=<LLM output>. Proxies to the GestureLSM
// service and returns the SMPL-X .npz bytes; PC-A retargets it to the MMD avatar.
export async function POST(req: Request) {
  const t0 = Date.now();
  const gate = await gateRequest(req, PATH, MODEL);
  if (!gate.ok) return gate.response;
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: MODEL, path: PATH, code: "bad_request" });
      return gatewayError("bad_request", { detail: "multipart/form-data with an audio file is required" });
    }
    const audio = form.get("audio");
    const text = (form.get("text") as string | null) ?? "";
    const format = (form.get("format") as string | null) ?? "joints";
    if (!(audio instanceof Blob)) {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: MODEL, path: PATH, code: "bad_request" });
      return gatewayError("bad_request", { detail: "audio file is required" });
    }

    try {
      const health = await gestureHealth();
      if (!health?.ok) {
        await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: MODEL, path: PATH, code: "unavailable" });
        return gatewayError("unavailable", { detail: "gesture service unreachable" });
      }
      const npz = await gestureGenerate(audio, text, format);
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, latencyMs: Date.now() - t0, model: MODEL, path: PATH });
      return new NextResponse(new Uint8Array(npz), {
        status: 200,
        headers: {
          ...corsHeaders(req.headers.get("origin")),
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="gesture.npz"',
        },
      });
    } catch (e) {
      const key = isTimeoutError(e) ? "backend_timeout" : "backend_error";
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: MODEL, path: PATH, code: key });
      return gatewayError(key);
    }
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
