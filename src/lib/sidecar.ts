import "server-only";

// Client for the Python model sidecar (model-service/app.py). Mirrors the Ollama
// client: the gateway proxies non-LLM capabilities (OCR, detection, STT, TTS,
// background removal) here. Default host 127.0.0.1:8000; override SIDECAR_HOST.

const SIDECAR = process.env.SIDECAR_HOST ?? "http://127.0.0.1:8000";

export interface SidecarHealth {
  ok: boolean;
  capabilities: Record<string, boolean>; // removebg, detect, stt, ocr, tts
  loaded: Record<string, boolean>;
}

// app modelId -> sidecar capability key (the models the sidecar serves).
export const SIDECAR_MODELS: Record<string, string> = {
  yolo11s: "detect",
  paddleocr: "ocr",
  "faster-whisper-medium": "stt",
  "kokoro-82m": "tts",
  rembg: "removebg",
};

// Health is probed on the CRITICAL PATH: /v1/audio/transcriptions calls it
// before every transcription to decide whether to use the sidecar, so an
// uncached probe put a serialized round trip (measured 3.4ms on loopback) in
// front of every spoken turn of a live conversation.
//
// A short TTL is safe here because the probe is not the safety mechanism — the
// real call is. A sidecar that dies inside the TTL makes one request take the
// error path it already handles; the next probe then reports it down. The TTL
// is deliberately shorter than a human turn, so a recovering sidecar is picked
// up within one exchange.
const HEALTH_TTL_MS = 2000;
let healthCache: { at: number; value: SidecarHealth | null } | null = null;
let healthInFlight: Promise<SidecarHealth | null> | null = null;

export async function sidecarHealth(ms = 3000): Promise<SidecarHealth | null> {
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_TTL_MS) return healthCache.value;
  // Concurrent callers share one probe rather than each opening their own.
  if (healthInFlight) return healthInFlight;
  healthInFlight = (async () => {
    try {
      const r = await fetch(`${SIDECAR}/health`, { cache: "no-store", signal: AbortSignal.timeout(ms) });
      const value = r.ok ? ((await r.json()) as SidecarHealth) : null;
      healthCache = { at: Date.now(), value };
      return value;
    } catch {
      healthCache = { at: Date.now(), value: null };
      return null;
    } finally {
      healthInFlight = null;
    }
  })();
  return healthInFlight;
}

function form(file: Buffer, filename: string, fields?: Record<string, string>): FormData {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(file)]), filename);
  for (const [k, v] of Object.entries(fields ?? {})) fd.append(k, v);
  return fd;
}

async function postForm(path: string, fd: FormData, ms = 180_000): Promise<Response> {
  return fetch(`${SIDECAR}${path}`, { method: "POST", body: fd, signal: AbortSignal.timeout(ms) });
}

export async function sidecarRemoveBg(file: Buffer): Promise<Buffer> {
  const r = await postForm("/remove-bg", form(file, "input.png"));
  if (!r.ok) throw new Error(`sidecar remove-bg ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function sidecarDetect(file: Buffer, model?: string): Promise<unknown> {
  const r = await postForm("/detect", form(file, "input.jpg", model ? { model } : undefined));
  if (!r.ok) throw new Error(`sidecar detect ${r.status}`);
  return r.json();
}

export async function sidecarStt(
  file: Buffer,
  model?: string,
  language?: string,
  beamSize?: string,
  initialPrompt?: string,
  vadFilter?: string,
): Promise<{ text: string; language?: string }> {
  const extra: Record<string, string> = {};
  if (model) extra.model = model;
  // Accented-speech decoding aids (see model-service/app.py).
  if (beamSize) extra.beam_size = beamSize;
  if (initialPrompt) extra.initial_prompt = initialPrompt;
  if (vadFilter) extra.vad_filter = vadFilter;
  // Whisper language hint ("en"/"ja"; "" = auto-detect). Without forwarding
  // this, the sidecar pinned its default and EN speech transcribed in JA mode.
  if (language !== undefined) extra.language = language;
  const r = await postForm("/stt", form(file, "audio.wav", Object.keys(extra).length ? extra : undefined));
  if (!r.ok) throw new Error(`sidecar stt ${r.status}`);
  return (await r.json()) as { text: string; language?: string };
}

export async function sidecarOcr(file: Buffer): Promise<unknown> {
  const r = await postForm("/ocr", form(file, "input.jpg"));
  if (!r.ok) throw new Error(`sidecar ocr ${r.status}`);
  return r.json();
}

export async function sidecarUnload(cap: string): Promise<void> {
  const fd = new FormData();
  fd.append("cap", cap);
  const r = await postForm("/unload", fd, 30_000);
  if (!r.ok) throw new Error(`sidecar unload ${r.status}`);
}

export async function sidecarTts(text: string, voice?: string): Promise<Buffer> {
  const fd = new FormData();
  fd.append("text", text);
  if (voice) fd.append("voice", voice);
  const r = await postForm("/tts", fd);
  if (!r.ok) throw new Error(`sidecar tts ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
