import "server-only";

// Client for the local voice stack that backs the `gpt-sovits` TTS model.
//
// Topology (all localhost): the gateway calls voice_service.py on :9881, which is
// a DROP-IN for GPT-SoVITS' /tts — it calls GPT-SoVITS (:9880) for synthesis and
// then applies the RVC voice (Rem) in-process, returning one WAV. So the gateway
// talks to ONE endpoint and gets the final audio. Override the host with TTS_HOST.
//
// The reference-audio / prompt / tuning defaults below mirror the values the
// desktop app already sends (captured from the live service), so gateway audio
// matches the app's. Every default is overridable by env for a different voice.

const TTS_HOST = process.env.TTS_HOST ?? "http://127.0.0.1:9881";

// app modelId that routes here.
export const TTS_MODEL_ID = "gpt-sovits";

// Fixed voice identity + quality knobs (captured from the working app requests).
const REF_AUDIO = process.env.TTS_REF_AUDIO ?? "/home/ai-ccore/Documents/DEV/AICCORE-Nexus/stack/voice/refs/f02_025.wav";
// Aux refs dropped (2026-07-20, mirrors the app): the loaded weights are FINE-TUNED
// on Rem (RemGSV), so extra reference clips only add ~0.2s. Re-add via TTS_AUX_REFS
// if the voice drifts.
const AUX_REFS = (process.env.TTS_AUX_REFS ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const PROMPT_TEXT = process.env.TTS_PROMPT_TEXT ??
  "今日はレーって始まってムーで終わる名前の女の子と一緒にいるといいことがありますよ。";
const TEXT_LANG = process.env.TTS_TEXT_LANG ?? "ja";
const PROMPT_LANG = process.env.TTS_PROMPT_LANG ?? "ja";

// Sampler / batching defaults (same as the app; tuned for latency + the Rem voice).
const TUNING: Record<string, string> = {
  // cut0 = no server-side splitting: callers already send one sentence per request.
  text_split_method: "cut0",
  batch_size: "4",
  top_k: "10",
  top_p: "0.8",
  temperature: "0.6",
  repetition_penalty: "1.35",
  split_bucket: "True",
  parallel_infer: "True",
  speed_factor: "1.05",
  fragment_interval: "0.0",
  streaming_mode: "false",
};

export interface TtsHealth {
  ok: boolean;
  rvc_enabled?: boolean;
  rvc_model?: string | null;
  rvc_loaded?: boolean;
}

// Liveness of the voice stack (voice_service :9881, which fronts GPT-SoVITS :9880).
export async function ttsHealth(ms = 2500): Promise<TtsHealth | null> {
  try {
    const r = await fetch(`${TTS_HOST}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    return (await r.json()) as TtsHealth;
  } catch {
    return null;
  }
}

export interface TtsOptions {
  format?: string;   // wav | ogg | aac (GPT-SoVITS media_type); default wav
  language?: string; // text_lang override (default ja)
  rvc?: boolean;     // apply the RVC voice (default true)
}

// text -> WAV (or requested media_type) bytes via the voice stack. Blocks until
// the audio is ready (per-sentence synthesis is ~1-2s). Throws on backend error.
export async function ttsSynthesize(text: string, opts: TtsOptions = {}, ms = 120_000): Promise<Buffer> {
  const params = new URLSearchParams({
    text,
    text_lang: opts.language ?? TEXT_LANG,
    ref_audio_path: REF_AUDIO,
    prompt_lang: PROMPT_LANG,
    prompt_text: PROMPT_TEXT,
    media_type: opts.format ?? "wav",
    ...TUNING,
  });
  for (const aux of AUX_REFS) params.append("aux_ref_audio_paths", aux);
  if (opts.rvc === false) params.set("rvc", "0");

  const r = await fetch(`${TTS_HOST}/tts?${params.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`tts ${r.status}: ${await r.text().catch(() => "")}`.slice(0, 300));
  return Buffer.from(await r.arrayBuffer());
}
