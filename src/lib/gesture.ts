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

// Optional speed/transfer knobs forwarded to the gesture service. All optional and
// additive — omitting them keeps the service's own defaults (2-step, JSON joints).
export interface GestureOptions {
  precision?: string;     // "f16" -> compact float16 joints payload (~7x smaller).
                          // The CONSUMER (PC-A retarget) must decode `joints_f16_b64`
                          // (base64 float16, reshape to `shape`) instead of `joints`.
  steps?: string;         // sampling steps override; fewer = faster.
  guidanceScale?: string; // <=1.0 => CFG off (faster); >1.0 => stronger but 2x slower.
  dur?: string;           // real speech seconds -> server trims the silence-pad tail.
}

// Forward the audio (+ LLM text) to the gesture service; returns the response body
// (SMPL-X joints JSON by default; format=npz returns raw params). Word timing is a
// uniform TextGrid server-side (no MFA); text = the assistant's spoken words (no ASR).
export async function gestureGenerate(audio: Blob, text: string, format = "joints", opts: GestureOptions = {}, ms = 120_000): Promise<Buffer> {
  const form = new FormData();
  form.append("audio", audio, "audio.wav");
  form.append("text", text ?? "");
  form.append("format", format);
  // pass through only when set; the service treats "" as "use default".
  if (opts.precision) form.append("precision", opts.precision);
  if (opts.steps) form.append("steps", opts.steps);
  if (opts.guidanceScale) form.append("guidance_scale", opts.guidanceScale);
  if (opts.dur) form.append("dur", opts.dur);
  const r = await fetch(`${GESTURE}/gesture`, { method: "POST", body: form, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`gesture generate ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
