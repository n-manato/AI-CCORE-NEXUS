import { NextResponse } from "next/server";
import { gateRequest, gatewayError, corsHeaders, recordUsage, isTimeoutError } from "@/lib/gateway";
import { trellisHealth, trellisGenerate, TRELLIS_RESOLUTIONS } from "@/lib/trellis";

export const dynamic = "force-dynamic";

const PATH = "/v1/3d/generations";
const MODEL = "trellis-2";

// POST /v1/3d/generations - single image -> PBR-textured 3D asset (GLB).
// multipart/form-data: image=<png/jpg>, optional resolution=512|1024|1536, seed,
// texture_size, decimation_target. Proxies to the TRELLIS.2 service and returns
// the .glb bytes. Sync (blocks up to ~5 min); the gateway serializes on the GPU.
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
      return gatewayError("bad_request", { detail: "multipart/form-data with an image file is required" });
    }
    const image = form.get("image");
    if (!(image instanceof Blob)) {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: MODEL, path: PATH, code: "bad_request" });
      return gatewayError("bad_request", { detail: "image file is required" });
    }
    const resolution = (form.get("resolution") as string | null) ?? undefined;
    if (resolution && !TRELLIS_RESOLUTIONS.includes(resolution as (typeof TRELLIS_RESOLUTIONS)[number])) {
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: MODEL, path: PATH, code: "bad_request" });
      return gatewayError("bad_request", { detail: `resolution must be one of ${TRELLIS_RESOLUTIONS.join(", ")}` });
    }
    const seedRaw = form.get("seed") as string | null;
    const texRaw = form.get("texture_size") as string | null;
    const decRaw = form.get("decimation_target") as string | null;

    try {
      const health = await trellisHealth();
      if (!health?.ok) {
        await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: true, model: MODEL, path: PATH, code: "unavailable" });
        return gatewayError("unavailable", { detail: "trellis service unreachable" });
      }
      const glb = await trellisGenerate(image, {
        resolution,
        seed: seedRaw ? Number(seedRaw) : undefined,
        textureSize: texRaw ? Number(texRaw) : undefined,
        decimationTarget: decRaw ? Number(decRaw) : undefined,
      });
      await recordUsage({ userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, isError: false, latencyMs: Date.now() - t0, model: MODEL, path: PATH });
      return new NextResponse(new Uint8Array(glb), {
        status: 200,
        headers: {
          ...corsHeaders(req.headers.get("origin")),
          "Content-Type": "model/gltf-binary",
          "Content-Disposition": 'attachment; filename="trellis.glb"',
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
