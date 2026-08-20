// Content for the admin "API Guide & OpenAI Migration" page.
//
// Facts here are verified against the running gateway:
// - Unknown OpenAI params (temperature, top_p, penalties, seed, n, stop) are
//   accepted (stripped by validation) -> they never cause errors; a real backend
//   applies them.
// - stream:true returns a single JSON object (NOT SSE) -> OpenAI SDK streaming
//   must be left off for now.
// - chat `content` must be a string; image content arrays return 400 -> use the
//   /v1/vision/* endpoints for images.

export function originOf(base: string): string {
  return base.replace(/\/v1\/?$/, "");
}

// ---- Chat parameter reference ----

export interface ChatParam {
  name: string;
  type: string;
  def: string;
  effect: string;
  support: string;
}

export const CHAT_PARAMS: ChatParam[] = [
  { name: "model", type: "string", def: "—", effect: "Which model runs the request. Use a fast model for interactive UX, a quality model for hard tasks.", support: "Required, validated" },
  { name: "messages", type: "array", def: "—", effect: "The conversation: { role: 'system'|'user'|'assistant', content: string }. system sets behavior; user is the prompt.", support: "Required, validated (content must be a string)" },
  { name: "max_tokens", type: "integer", def: "model default", effect: "Upper bound on the reply length. Lower = shorter and faster.", support: "Validated (positive int)" },
  { name: "temperature", type: "number 0–2", def: "1", effect: "Randomness. 0–0.3 = focused/deterministic; 0.8–1.2 = creative/varied. Lower it for extraction/classification, raise it for brainstorming.", support: "Accepted; applied by a real backend (ignored by the mock)" },
  { name: "top_p", type: "number 0–1", def: "1", effect: "Nucleus sampling. 0.9 keeps the top 90% probability mass. Tune temperature OR top_p, not both.", support: "Accepted; applied by a real backend" },
  { name: "stop", type: "string | string[]", def: "none", effect: "Generation stops when one of these sequences appears.", support: "Accepted; applied by a real backend" },
  { name: "presence_penalty", type: "number -2–2", def: "0", effect: "Higher pushes the model toward new topics (penalizes tokens already present).", support: "Accepted; applied by a real backend" },
  { name: "frequency_penalty", type: "number -2–2", def: "0", effect: "Higher reduces verbatim repetition.", support: "Accepted; applied by a real backend" },
  { name: "seed", type: "integer", def: "none", effect: "Best-effort reproducibility for identical inputs.", support: "Accepted; applied by a real backend" },
  { name: "n", type: "integer", def: "1", effect: "How many completions to return.", support: "Accepted; the mock returns 1" },
  { name: "stream", type: "boolean", def: "false", effect: "Server-sent token streaming.", support: "⚠ Not supported yet — keep false. stream:true returns one JSON object and will break SDK stream parsers." },
];

// ---- OpenAI -> gateway model mapping (suggested equivalents) ----

export interface ModelMap {
  openai: string;
  gateway: string;
  via: string;
}

export const OPENAI_MODEL_MAP: ModelMap[] = [
  { openai: "gpt-4o-mini / gpt-3.5-turbo", gateway: "qwen3-8b", via: "/v1/chat/completions" },
  { openai: "gpt-4o / gpt-4.1", gateway: "qwen3-14b or qwen3-32b-4bit", via: "/v1/chat/completions" },
  { openai: "gpt-4o (coding)", gateway: "qwen2.5-coder-14b", via: "/v1/chat/completions" },
  { openai: "gpt-4o vision", gateway: "qwen3.6-27b", via: "/v1/responses (input_image) or /v1/vision/chat (file upload)" },
  { openai: "tts-1 / tts-1-hd", gateway: "kokoro-82m / gpt-sovits", via: "/v1/audio/speech" },
  { openai: "whisper-1", gateway: "faster-whisper-medium / large-v3", via: "/v1/audio/transcriptions" },
  { openai: "dall-e-3 / gpt-image-1", gateway: "flux-schnell / flux-dev", via: "/v1/images/generations (Job)" },
  { openai: "text-embedding-3-*", gateway: "(used internally by RAG)", via: "/v1/rag/query — no standalone embeddings endpoint yet" },
];

// ---- Troubleshooting ----

export interface Trouble {
  symptom: string;
  cause: string;
  fix: string;
}

export const TROUBLESHOOTING: Trouble[] = [
  { symptom: "401 invalid_api_key", cause: "Missing / wrong / disabled key, or key in the URL.", fix: "Reveal a fresh key (My Access), send it as Authorization: Bearer <key>. Never put it in the URL." },
  { symptom: "403 access_denied", cause: "Your account lacks access to that category.", fix: "Ask an admin to enable the category in Users & API Access." },
  { symptom: "404 not_found", cause: "Wrong path, base_url missing /v1, or the model is Not Installed.", fix: "Ensure base_url ends with /v1; check GET /v1/models and Model Runtime." },
  { symptom: "Hangs / parse error with the OpenAI SDK", cause: "You set stream=True; the gateway returns one JSON, not SSE.", fix: "Set stream=False (streaming is not supported yet)." },
  { symptom: "400 bad_request on chat with an image", cause: "messages[].content was an array (OpenAI vision format).", fix: "Use /v1/vision/chat with a multipart file. chat content must be a string." },
  { symptom: "400 on transcriptions", cause: "No audio file in the multipart body.", fix: "Send the audio as the multipart field 'file'." },
  { symptom: "Connection refused / can't reach", cause: "Server not running, wrong port, or unreachable host IP.", fix: "Run npm run dev; use the forwarded localhost base URL." },
  { symptom: "429 rate_limited", cause: "Too many invalid key attempts from your IP.", fix: "Stop, fix the key, wait a few minutes." },
  { symptom: "503 maintenance", cause: "Maintenance Mode is on (normal users blocked).", fix: "Retry later or ask an admin." },
];

// ---- Code / env snippets (base-substituted) ----

export function envMinimal(base: string): string {
  return `# Minimal migration: keep your existing OpenAI code, just change the env.
# The OpenAI SDK auto-reads these two variables.
OPENAI_BASE_URL=${base}
OPENAI_API_KEY=lag_xxxxxxxxxxxxxxxxxxxxxxxx
# Only change you still need in code: use a gateway model id (e.g. "qwen3-8b").`;
}

export function envExplicit(base: string): string {
  return `# Explicit naming (recommended for new apps)
LAG_BASE_URL=${base}
LAG_API_KEY=lag_xxxxxxxxxxxxxxxxxxxxxxxx
# In Next.js: put LAG_API_KEY in .env.local WITHOUT a NEXT_PUBLIC_ prefix so it
# stays server-only. Call the gateway from a route handler / server action, never
# from client code. Add .env* to .gitignore.`;
}

export function pyOpenAiSdk(base: string): string {
  return `import os
from openai import OpenAI   # pip install openai

client = OpenAI(
    base_url=os.environ["LAG_BASE_URL"],   # ${base}
    api_key=os.environ["LAG_API_KEY"],
)

resp = client.chat.completions.create(
    model="qwen3-8b",                       # an id from GET /v1/models
    messages=[
        {"role": "system", "content": "You are a lab assistant."},
        {"role": "user", "content": "Summarize today's experiment."},
    ],
    temperature=0.3,
    max_tokens=300,
    # stream=False   # keep streaming OFF for now
)
print(resp.choices[0].message.content)`;
}

export function nodeOpenAiSdk(base: string): string {
  return `import OpenAI from "openai"; // npm i openai

const client = new OpenAI({
  baseURL: process.env.LAG_BASE_URL, // ${base}
  apiKey: process.env.LAG_API_KEY,
});

const resp = await client.chat.completions.create({
  model: "qwen3-8b",                  // an id from GET /v1/models
  messages: [
    { role: "system", content: "You are a lab assistant." },
    { role: "user", content: "Summarize today's experiment." },
  ],
  temperature: 0.3,
  max_tokens: 300,
  // stream: false  // keep streaming OFF for now
});
console.log(resp.choices[0].message.content);`;
}

export function claudeCodeSnippet(base: string): string {
  return `## Local AI Gateway (OpenAI-compatible)

This project calls the Local AI Gateway. When writing integration code:

- Base URL: ${base}   (must end with /v1)
- Auth: header \`Authorization: Bearer $LAG_API_KEY\`. Key lives in .env / .env.local,
  never committed, never prefixed NEXT_PUBLIC_, never sent from the browser.
- Use the official \`openai\` SDK with \`base_url\`/\`baseURL\` set to the Base URL above.
- Model ids come from GET /v1/models (e.g. "qwen3-8b", "qwen3-14b", "qwen2.5-coder-14b").
- DO NOT set stream=true (not supported yet). For images call /v1/vision/* with a
  file upload, NOT chat with an array \`content\`.
- Endpoints: /v1/chat/completions, /v1/models, /v1/audio/speech,
  /v1/audio/transcriptions, /v1/images/generations (returns a job_id to poll at
  /v1/jobs/{id}).
- On 401 check the key; on 403 the account lacks that category; on 404 check the
  path ends with /v1 and the model/API is installed.`;
}
