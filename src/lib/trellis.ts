import "server-only";

// Client for the TRELLIS.2 service (trellis-service/trellis_service.py). Mirrors
// lib/motion.ts / lib/gesture.ts so sync.ts / vram-scheduler treat it like the
// other dedicated GPU sidecars. Single image -> textured GLB. Default 127.0.0.1:8803.
// NOT served via Ollama — a dedicated Python GPU service.

const TRELLIS = process.env.TRELLIS_HOST ?? "http://127.0.0.1:8811";

export interface TrellisHealth {
  ok: boolean;
  capabilities: Record<string, boolean>; // { image_to_3d: boolean }
  loaded?: Record<string, boolean>;       // { trellis2: boolean }
  stub?: boolean;
  pinned?: boolean;                        // true = resident in VRAM (Always Running)
  cuda?: boolean;
  gpu?: string | null;
  model?: string;
  resolutions?: string[];
}

// app modelId -> trellis capability key (parallels MOTION_MODELS / GESTURE_MODELS).
export const TRELLIS_MODELS: Record<string, string> = {
  "trellis-2": "image_to_3d",
};

// Allowed output resolutions (pipeline_type). 512 is the low-VRAM default that
// fits a single 24GB card; higher values need the larger/free GPU.
export const TRELLIS_RESOLUTIONS = ["512", "1024", "1536"] as const;

export async function trellisHealth(ms = 3000): Promise<TrellisHealth | null> {
  try {
    const r = await fetch(`${TRELLIS}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    return (await r.json()) as TrellisHealth;
  } catch {
    return null;
  }
}

export interface TrellisOptions {
  resolution?: string;
  seed?: number;
  decimationTarget?: number;
  textureSize?: number;
}

// Forward the image to the TRELLIS.2 service; returns the .glb bytes. Generation
// takes ~seconds-to-a-minute depending on resolution, so allow a long timeout.
export async function trellisGenerate(image: Blob, opts: TrellisOptions = {}, ms = 300_000): Promise<Buffer> {
  const form = new FormData();
  form.append("image", image, "input.png");
  if (opts.resolution) form.append("resolution", opts.resolution);
  if (opts.seed !== undefined) form.append("seed", String(opts.seed));
  if (opts.decimationTarget !== undefined) form.append("decimation_target", String(opts.decimationTarget));
  if (opts.textureSize !== undefined) form.append("texture_size", String(opts.textureSize));
  const r = await fetch(`${TRELLIS}/generate`, { method: "POST", body: form, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`trellis generate ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
