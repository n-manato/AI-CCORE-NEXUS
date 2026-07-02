import "server-only";

// Thin client for a local Ollama server. Ollama exposes an OpenAI-compatible
// endpoint at /v1 (used for chat) and a native /api (used for vision + listing).
// Default host is localhost:11434; override with OLLAMA_HOST.

const OLLAMA = process.env.OLLAMA_HOST ?? "http://localhost:11434";

// Carries the upstream HTTP status and raw error body so the route can classify
// the failure (context overflow, template error, GPU pressure, ...) instead of
// surfacing an opaque 502. Thrown by ollamaChat on a non-2xx response.
export class OllamaError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`ollama ${status}: ${body.slice(0, 200)}`);
    this.name = "OllamaError";
  }
}

// Maps this app's registry model ids to the Ollama model tags we pull/run.
// This is the set of models the gateway can actually serve via Ollama.
export const OLLAMA_MAP: Record<string, string> = {
  "qwen3-8b": "qwen3:8b",
  "qwen3-14b": "qwen3:14b",
  "qwen3-32b-4bit": "qwen3:32b",
  "qwen2.5-coder-14b": "qwen2.5-coder:14b",
  "qwen2.5-coder-32b": "qwen2.5-coder:32b",
  "qwen3-coder-30b": "qwen3-coder:30b-a3b-q8_0",
  "qwen3-coder-next": "qwen3-coder-next:IQ4_XS",
  "qwen3.6-35b": "qwen3.6:35b-a3b-q6_K_L",
  "qwen3.6-27b": "qwen3.6-27b:Q8_0",
  "devstral-small-2": "devstral-small-2:Q8_0",
  "glm-4.7-flash": "glm-4.7-flash:Q8_0",
  "deepseek-r1-70b": "deepseek-r1:70b",
  "qwen2.5-vl-7b": "qwen2.5vl:7b",
  "qwen2.5-vl-32b": "qwen2.5vl:32b",
};

export const VISION_APP_IDS = ["qwen2.5-vl-7b", "qwen2.5-vl-32b"];
export const LLM_APP_IDS = [
  "qwen3-8b",
  "qwen3-14b",
  "qwen3-32b-4bit",
  "qwen2.5-coder-14b",
  "qwen2.5-coder-32b",
  "qwen3-coder-30b",
  "qwen3-coder-next",
  "qwen3.6-35b",
  "qwen3.6-27b",
  "devstral-small-2",
  "glm-4.7-flash",
  "deepseek-r1-70b",
];

export function appIdToTag(id: string): string | undefined {
  return OLLAMA_MAP[id];
}

const TAG_TO_APP: Record<string, string> = Object.fromEntries(
  Object.entries(OLLAMA_MAP).map(([app, tag]) => [tag, app]),
);

// Reverse of appIdToTag: maps a raw Ollama tag ("deepseek-r1:70b") back to the
// registry model id ("deepseek-r1-70b"). Used to look up per-model config when a
// client sends the tag form. Returns undefined for unknown tags.
export function tagToAppId(tag: string): string | undefined {
  return TAG_TO_APP[tag];
}

// Normalizes either form (registry id or raw tag) to the registry model id used
// as the modelRuntimeConfig key; falls back to the input if unrecognized.
export function toAppId(modelOrTag: string): string {
  if (modelOrTag in OLLAMA_MAP) return modelOrTag;
  return TAG_TO_APP[modelOrTag] ?? modelOrTag;
}

interface OllamaTag {
  name: string;
  size?: number;
  details?: { family?: string; parameter_size?: string };
}

async function getJson(path: string, ms = 4000): Promise<unknown | null> {
  try {
    const r = await fetch(`${OLLAMA}${path}`, { cache: "no-store", signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Models present in Ollama (pulled). null => Ollama unreachable.
export async function ollamaTags(): Promise<OllamaTag[] | null> {
  const d = (await getJson("/api/tags")) as { models?: OllamaTag[] } | null;
  if (!d) return null;
  return d.models ?? [];
}

// Tag names currently loaded into VRAM (ollama /api/ps).
export async function ollamaRunning(ms = 4000): Promise<Set<string>> {
  const d = (await getJson("/api/ps", ms)) as { models?: { name: string }[] } | null;
  return new Set((d?.models ?? []).map((m) => m.name));
}

export async function ollamaReachable(): Promise<boolean> {
  return (await ollamaTags()) !== null;
}

export async function ollamaHasTag(tag: string): Promise<boolean> {
  const tags = await ollamaTags();
  if (!tags) return false;
  return tags.some((t) => t.name === tag);
}

// OpenAI-compatible chat passthrough. Returns the OpenAI-shaped JSON.
export async function ollamaChat(tag: string, body: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(`${OLLAMA}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, model: tag, stream: false, keep_alive: -1 }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!r.ok) throw new OllamaError(r.status, await r.text().catch(() => ""));
  return r.json();
}

// OpenAI-compatible streaming chat. Returns the raw upstream Response so the
// route can pipe the SSE body straight back to the client (used by Cline etc.).
// Large models load lazily, so allow a long timeout for the first token.
export async function ollamaChatStream(tag: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${OLLAMA}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, model: tag, stream: true, keep_alive: -1 }),
    signal: AbortSignal.timeout(600_000),
  });
}

// Really load or unload a model in VRAM via an empty generate call. keepAlive:
// "5m" (default load), 0 (unload), -1 (pin = never auto-unload, for Always Running).
export async function ollamaSetLoaded(
  tag: string,
  load: boolean,
  keepAlive: string | number = load ? "5m" : 0,
): Promise<void> {
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: tag, prompt: "", keep_alive: keepAlive }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`ollama setLoaded ${r.status}`);
}

// Vision via the native /api/chat with a base64 image. Returns the reply text.
export async function ollamaVision(tag: string, prompt: string, imageBase64: string): Promise<string> {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: tag,
      stream: false,
      keep_alive: -1,
      messages: [{ role: "user", content: prompt, images: [imageBase64] }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`ollama vision ${r.status}`);
  const d = (await r.json()) as { message?: { content?: string } };
  return d.message?.content ?? "";
}
