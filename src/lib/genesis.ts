import "server-only";

// Client for the Genesis3D orchestrator (Genesis3D/orchestrator/app.py). Mirrors
// lib/trellis.ts / lib/motion.ts so sync.ts and the VRAM scheduler treat it like the
// other dedicated GPU sidecars. Single image -> multi-candidate 3D -> rigged VRM.
//
// Unlike /v1/3d/generations (TRELLIS, synchronous, returns GLB bytes), Genesis3D is
// ASYNCHRONOUS: a job runs ~80s-several minutes across 10 stages. The gateway only
// creates/polls jobs here; Genesis3D owns its own GPU scheduling (NVML preflight on
// GPU0, and it never loads a new model onto GPU1 where TRELLIS.2 is pinned).

const GENESIS = process.env.GENESIS_HOST ?? "http://127.0.0.1:8820";

export interface GenesisHealth {
  ok: boolean;
  service?: string;
  version?: string;
  gpu_source?: string;
  gpu_count?: number;
  trellis_reachable?: boolean;
  blender?: boolean;
  data_dir?: string;
}

// app modelId -> genesis capability key (parallels TRELLIS_MODELS / MOTION_MODELS).
export const GENESIS_MODELS: Record<string, string> = {
  genesis3d: "image_to_vrm",
};

export const GENESIS_STYLES = ["stylized", "realistic_jrpg"] as const;
export const GENESIS_QUALITIES = ["fast", "high", "maximum"] as const;
export const GENESIS_FORMATS = ["vrm", "glb"] as const;

export async function genesisHealth(ms = 3000): Promise<GenesisHealth | null> {
  try {
    const r = await fetch(`${GENESIS}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(ms),
    });
    if (!r.ok) return null;
    return (await r.json()) as GenesisHealth;
  } catch {
    return null;
  }
}

export interface GenesisJobOptions {
  style: string;
  quality: string;
  outputFormat?: string;
  models?: string;
  multiCandidate?: boolean;
}

export interface GenesisJob {
  job_id: string;
  status: string;
  stage?: string | null;
  progress?: number;
  gpu?: number | null;
  style?: string;
  quality?: string;
  error?: string | null;
  created_at?: number;
  started_at?: number | null;
  completed_at?: number | null;
}

// Creates a job and returns immediately. Generation continues in Genesis3D; poll
// with genesisJob(). Kept short so the gateway's model lease is momentary.
export async function genesisCreateJob(
  image: Blob,
  opts: GenesisJobOptions,
  ms = 60_000,
  // Optional real photo for the face. When the body comes from a generated
  // T-pose image its face is NOT the person (measured ArcFace 0.20), so
  // Genesis3D builds the head from this portrait instead and merges it
  // (measured ArcFace 0.66). Omit and Genesis3D falls back to `image`.
  faceImage?: Blob | null,
): Promise<GenesisJob> {
  const form = new FormData();
  form.append("image", image, "input.png");
  if (faceImage) form.append("face_image", faceImage, "face.png");
  form.append("style", opts.style);
  form.append("quality", opts.quality);
  form.append("output_format", opts.outputFormat ?? "vrm");
  form.append("models", opts.models ?? "auto");
  form.append("multi_candidate", String(opts.multiCandidate ?? true));
  const r = await fetch(`${GENESIS}/jobs`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`genesis create job ${r.status}: ${await r.text()}`);
  return (await r.json()) as GenesisJob;
}

export async function genesisJob(jobId: string, ms = 10_000): Promise<GenesisJob | null> {
  try {
    const r = await fetch(`${GENESIS}/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(ms),
    });
    if (!r.ok) return null;
    return (await r.json()) as GenesisJob;
  } catch {
    return null;
  }
}

export async function genesisResults(jobId: string, ms = 15_000): Promise<unknown | null> {
  try {
    const r = await fetch(`${GENESIS}/jobs/${encodeURIComponent(jobId)}/results`, {
      cache: "no-store",
      signal: AbortSignal.timeout(ms),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Streams one artifact (character.vrm / character.glb / validation.json / job.json).
export async function genesisFile(
  jobId: string,
  filename: string,
  ms = 120_000,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  try {
    const r = await fetch(
      `${GENESIS}/jobs/${encodeURIComponent(jobId)}/results/${encodeURIComponent(filename)}`,
      { signal: AbortSignal.timeout(ms) },
    );
    if (!r.ok) return null;
    return {
      bytes: await r.arrayBuffer(),
      contentType: r.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export async function genesisCancel(jobId: string, ms = 10_000): Promise<boolean> {
  try {
    const r = await fetch(`${GENESIS}/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
      signal: AbortSignal.timeout(ms),
    });
    return r.ok;
  } catch {
    return false;
  }
}
