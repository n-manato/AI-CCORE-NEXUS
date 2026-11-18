import { NextResponse } from "next/server";
import {
  gateRequest, gatewayError, corsHeaders, recordUsage, isTimeoutError,
  type ErrorKey,
} from "@/lib/gateway";
import {
  GENESIS_FORMATS, GENESIS_QUALITIES, GENESIS_STYLES,
  genesisCreateJob, genesisHealth,
} from "@/lib/genesis";

export const dynamic = "force-dynamic";

const PATH = "/v1/3d/characters";
const MODEL = "genesis3d";

// POST /v1/3d/characters - single image -> rigged VRM 1.0 character.
// multipart/form-data: image=<png/jpg>, style=stylized|realistic_jrpg,
// quality=fast|high|maximum, output_format=vrm|glb,
// face_image=<png/jpg> (optional; real portrait used only for the face).
//
// ASYNC: returns a job_id immediately; poll GET /v1/3d/characters/{job_id}.
// A job runs ~80s-several minutes (preprocess -> multi-candidate generation ->
// render -> automatic evaluation -> mesh repair -> rigging -> VRM export).
//
// The gateway's model lease is held only for THIS call (sub-second): it starts
// Genesis3D on demand, then releases. Genesis3D owns GPU scheduling for the job
// itself (NVML preflight on GPU0; it never loads onto GPU1 where TRELLIS.2 is pinned).
export async function POST(req: Request) {
  const t0 = Date.now();
  const gate = await gateRequest(req, PATH, MODEL);
  if (!gate.ok) return gate.response;
  const fail = async (code: ErrorKey, detail?: string) => {
    await recordUsage({
      userId: gate.auth.userId, apiName: gate.apiName, category: gate.category,
      isError: true, model: MODEL, path: PATH, code,
    });
    return gatewayError(code, detail ? { detail } : undefined);
  };

  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return await fail("bad_request", "multipart/form-data with an image file is required");
    }

    const image = form.get("image");
    if (!(image instanceof Blob)) return await fail("bad_request", "image file is required");
    if (image.size === 0) return await fail("bad_request", "image file is empty");

    // Optional: real portrait used only for the face. See genesisCreateJob.
    const faceImage = form.get("face_image");
    if (faceImage !== null && !(faceImage instanceof Blob)) {
      return await fail("bad_request", "face_image must be a file");
    }
    if (faceImage instanceof Blob && faceImage.size === 0) {
      return await fail("bad_request", "face_image file is empty");
    }

    const style = (form.get("style") as string | null) ?? "stylized";
    if (!GENESIS_STYLES.includes(style as (typeof GENESIS_STYLES)[number])) {
      return await fail("bad_request", `style must be one of ${GENESIS_STYLES.join(", ")}`);
    }
    const quality = (form.get("quality") as string | null) ?? "high";
    if (!GENESIS_QUALITIES.includes(quality as (typeof GENESIS_QUALITIES)[number])) {
      return await fail("bad_request", `quality must be one of ${GENESIS_QUALITIES.join(", ")}`);
    }
    const outputFormat = (form.get("output_format") as string | null) ?? "vrm";
    if (!GENESIS_FORMATS.includes(outputFormat as (typeof GENESIS_FORMATS)[number])) {
      return await fail("bad_request", `output_format must be one of ${GENESIS_FORMATS.join(", ")}`);
    }

    try {
      const health = await genesisHealth();
      if (!health?.ok) return await fail("unavailable", "genesis3d service unreachable");

      const job = await genesisCreateJob(image, {
        style, quality, outputFormat,
        models: (form.get("models") as string | null) ?? "auto",
        multiCandidate: (form.get("multi_candidate") as string | null) !== "false",
      }, 60_000, faceImage instanceof Blob ? faceImage : null);

      await recordUsage({
        userId: gate.auth.userId, apiName: gate.apiName, category: gate.category,
        isError: false, latencyMs: Date.now() - t0, model: MODEL, path: PATH,
      });
      return NextResponse.json(
        {
          job_id: job.job_id,
          status: job.status,
          style, quality, output_format: outputFormat,
          poll: `/v1/3d/characters/${job.job_id}`,
        },
        { status: 202, headers: corsHeaders(req.headers.get("origin")) },
      );
    } catch (e) {
      return await fail(isTimeoutError(e) ? "backend_timeout" : "backend_error");
    }
  } finally {
    gate.release();
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
