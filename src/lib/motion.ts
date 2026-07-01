import "server-only";

// Client for the HY-Motion service (motion-service/server.py). Mirrors the sidecar
// client: the gateway proxies /v1/motion/* here and returns the .vmd to clients.
// Default host 127.0.0.1:8801; override MOTION_HOST. Localhost-only, like Ollama.

const MOTION = process.env.MOTION_HOST ?? "http://127.0.0.1:8801";

export interface MotionHealth {
  ok: boolean;
  capabilities: Record<string, boolean>; // { motion: boolean }
  loaded: Record<string, boolean>;       // { hy_motion: boolean }
  stub?: boolean;
  pool?: Record<string, number>;
}

// app modelId -> motion capability key.
export const MOTION_MODELS: Record<string, string> = {
  "hy-motion-1": "motion",
};

// Emotion set shared with PC-A (mirrors motion-service/prompts.py EMOTIONS).
export const EMOTIONS = ["neutral", "happy", "sad", "thinking", "surprised", "angry", "shy"] as const;

export async function motionHealth(ms = 3000): Promise<MotionHealth | null> {
  try {
    const r = await fetch(`${MOTION}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    return (await r.json()) as MotionHealth;
  } catch {
    return null;
  }
}

export interface MotionRequest {
  prompt?: string;
  emotion?: string;
  duration?: number;
  seed?: number;
}

// format "vmd" -> .vmd Buffer; format "smpl" -> raw SMPL JSON (PC-A retargets it).
export async function motionGenerate(body: MotionRequest, format = "vmd", ms = 180_000): Promise<Buffer | unknown> {
  const q = format === "smpl" ? "?format=smpl" : "";
  const r = await fetch(`${MOTION}/generate${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`motion generate ${r.status}`);
  return format === "smpl" ? await r.json() : Buffer.from(await r.arrayBuffer());
}

// Pulls a warm clip for an emotion. Instant when warm; the service blocks briefly
// to generate one when momentarily empty (so this rarely returns null). `null`
// only on a true 503 so the caller can fall back to an idle animation. format
// "smpl" returns raw SMPL JSON instead of a .vmd Buffer.
export async function motionPool(emotion: string, format = "vmd", ms = 20_000): Promise<Buffer | unknown | null> {
  const q = format === "smpl" ? "?format=smpl" : "";
  const r = await fetch(`${MOTION}/pool/${encodeURIComponent(emotion)}${q}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(ms),
  });
  if (r.status === 503) return null;
  if (!r.ok) throw new Error(`motion pool ${r.status}`);
  return format === "smpl" ? await r.json() : Buffer.from(await r.arrayBuffer());
}
