import "server-only";

// Client for the GestureLSM gesture service (gesturelsm/gesture_service.py).
// audio(+text) -> SMPL-X joints; PC-A retargets to MMD. Default 127.0.0.1:8802.
// Mirrors lib/motion.ts so sync.ts / vram-scheduler treat it like HY-Motion.

const GESTURE = process.env.GESTURE_HOST ?? "http://127.0.0.1:8802";

export interface GestureHealth {
  ok: boolean;
  capabilities: Record<string, boolean>; // { gesture: boolean }
  loaded?: Record<string, boolean>;       // { gesturelsm: boolean }
  cuda?: boolean;
  gpu?: string | null;
}

// app modelId -> gesture capability key (parallels MOTION_MODELS).
export const GESTURE_MODELS: Record<string, string> = {
  "gesturelsm-1": "gesture",
};

export async function gestureHealth(ms = 3000): Promise<GestureHealth | null> {
  try {
    const r = await fetch(`${GESTURE}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    return (await r.json()) as GestureHealth;
  } catch {
    return null;
  }
}

// Forward the audio (+ LLM text) to the gesture service; returns the response body
// (SMPL-X joints JSON by default; format=npz returns raw params). Word timing is a
// uniform TextGrid server-side (no MFA); text = the assistant's spoken words (no ASR).
export async function gestureGenerate(audio: Blob, text: string, format = "joints", ms = 120_000): Promise<Buffer> {
  const form = new FormData();
  form.append("audio", audio, "audio.wav");
  form.append("text", text ?? "");
  form.append("format", format);
  const r = await fetch(`${GESTURE}/gesture`, { method: "POST", body: form, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`gesture generate ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
