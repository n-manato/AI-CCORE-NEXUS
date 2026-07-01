// Developer documentation data for the Local AI Gateway API.
//
// This is the single source of truth for the in-app "How to Use" reference and
// docs/API.md. Endpoint facts here mirror the actual route handlers in
// src/app/v1/** and the gate in src/lib/gateway.ts. Code examples are generated
// from each endpoint's request spec so cURL / Python / Node stay consistent.

import type { Category, Mode } from "@/lib/constants";

export interface DocParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export type ReqSpec =
  | { kind: "json"; body: Record<string, unknown> }
  | { kind: "multipart"; fields: Record<string, string>; files: { field: string; example: string }[] }
  | { kind: "none" };

export interface EndpointDoc {
  category: Category | "Core";
  apiName: string; // matches api_status.apiName (null-ish for Core)
  name: string;
  method: "GET" | "POST";
  path: string; // includes leading /v1
  mode: Mode | "Core";
  implemented: "full" | "skeleton";
  summary: string;
  modelSelection?: string;
  params: DocParam[];
  request: ReqSpec;
  responseExample: string;
  binaryResponse?: boolean;
  notes?: string;
}

// ---- Example generators ----

function origin(base: string): string {
  return base.replace(/\/v1\/?$/, "");
}
export function fullUrl(base: string, path: string): string {
  return origin(base) + path;
}

function pyLit(value: unknown, indent = 0): string {
  const pad = "    ".repeat(indent);
  const padIn = "    ".repeat(indent + 1);
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => padIn + pyLit(v, indent + 1)).join(",\n");
    return `[\n${items}\n${pad}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  const body = entries.map(([k, v]) => `${padIn}${JSON.stringify(k)}: ${pyLit(v, indent + 1)}`).join(",\n");
  return `{\n${body}\n${pad}}`;
}

export function toCurl(base: string, ep: EndpointDoc): string {
  const url = fullUrl(base, ep.path);
  const auth = `-H "Authorization: Bearer $LAG_API_KEY"`;
  if (ep.method === "GET") return `curl ${url} \\\n  ${auth}`;
  const r = ep.request;
  if (r.kind === "json") {
    const out = ep.binaryResponse ? ` \\\n  --output out.bin` : "";
    return `curl ${url} \\\n  ${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(r.body)}'${out}`;
  }
  if (r.kind === "multipart") {
    const parts = [
      `curl ${url}`,
      auth,
      ...Object.entries(r.fields).map(([k, v]) => `-F ${k}=${v}`),
      ...r.files.map((f) => `-F ${f.field}=@${f.example}`),
      ...(ep.binaryResponse ? ["--output out.bin"] : []),
    ];
    return parts.join(" \\\n  ");
  }
  return `curl -X POST ${url} \\\n  ${auth}`;
}

export function toPython(base: string, ep: EndpointDoc): string {
  const url = fullUrl(base, ep.path);
  const head = `import os, requests\n\nAPI_KEY = os.environ["LAG_API_KEY"]\nheaders = {"Authorization": f"Bearer {API_KEY}"}\n\n`;
  if (ep.method === "GET") {
    return `${head}resp = requests.get("${url}", headers=headers)\nprint(resp.json())`;
  }
  const r = ep.request;
  if (r.kind === "json") {
    if (ep.binaryResponse) {
      return `${head}resp = requests.post(\n    "${url}",\n    headers=headers,\n    json=${pyLit(r.body, 1)},\n)\nwith open("out.bin", "wb") as f:\n    f.write(resp.content)`;
    }
    return `${head}resp = requests.post(\n    "${url}",\n    headers=headers,\n    json=${pyLit(r.body, 1)},\n)\nprint(resp.json())`;
  }
  if (r.kind === "multipart") {
    const files = "{" + r.files.map((f) => `"${f.field}": open("${f.example}", "rb")`).join(", ") + "}";
    return `${head}resp = requests.post(\n    "${url}",\n    headers=headers,\n    data=${pyLit(r.fields, 1)},\n    files=${files},\n)\nprint(resp.json())`;
  }
  return `${head}resp = requests.post("${url}", headers=headers)\nprint(resp.json())`;
}

export function toNode(base: string, ep: EndpointDoc): string {
  const url = fullUrl(base, ep.path);
  const bearer = "Authorization: `Bearer ${process.env.LAG_API_KEY}`";
  if (ep.method === "GET") {
    return `const res = await fetch("${url}", {\n  headers: { ${bearer} },\n});\nconsole.log(await res.json());`;
  }
  const r = ep.request;
  if (r.kind === "json") {
    const body = JSON.stringify(r.body, null, 2).replace(/\n/g, "\n  ");
    if (ep.binaryResponse) {
      return `import { writeFile } from "node:fs/promises";\n\nconst res = await fetch("${url}", {\n  method: "POST",\n  headers: {\n    ${bearer},\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify(${body}),\n});\nawait writeFile("out.bin", Buffer.from(await res.arrayBuffer()));`;
    }
    return `const res = await fetch("${url}", {\n  method: "POST",\n  headers: {\n    ${bearer},\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify(${body}),\n});\nconsole.log(await res.json());`;
  }
  if (r.kind === "multipart") {
    const lines = ["const form = new FormData();"];
    for (const [k, v] of Object.entries(r.fields)) lines.push(`form.append("${k}", "${v}");`);
    for (const f of r.files) lines.push(`form.append("${f.field}", fileBlob, "${f.example}"); // a File/Blob`);
    return `${lines.join("\n")}\n\nconst res = await fetch("${url}", {\n  method: "POST",\n  headers: { ${bearer} },\n  body: form,\n});\nconsole.log(await res.json());`;
  }
  return `const res = await fetch("${url}", {\n  method: "POST",\n  headers: { ${bearer} },\n});\nconsole.log(await res.json());`;
}

export function examplesFor(base: string, ep: EndpointDoc) {
  return { curl: toCurl(base, ep), python: toPython(base, ep), node: toNode(base, ep) };
}

// ---- Core endpoints (not category-gated; available to any valid key) ----

export const CORE_ENDPOINTS: EndpointDoc[] = [
  {
    category: "Core",
    apiName: "Models",
    name: "List models",
    method: "GET",
    path: "/v1/models",
    mode: "Core",
    implemented: "full",
    summary:
      "List the installed models your key may select, filtered by your category access. The `id` is what you pass in a request's `model` field.",
    params: [],
    request: { kind: "none" },
    responseExample: `{
  "object": "list",
  "data": [
    {
      "id": "qwen3-8b",
      "object": "model",
      "owned_by": "local",
      "category": "LLM",
      "function": "Chat fast",
      "backend": "vLLM",
      "device_plan": "1GPU",
      "status": "Running",
      "startup_policy": "Always Running",
      "estimated_vram_gb": { "min": 14, "max": 16 }
    }
  ]
}`,
  },
  {
    category: "Core",
    apiName: "Jobs",
    name: "Get job",
    method: "GET",
    path: "/v1/jobs/{job_id}",
    mode: "Core",
    implemented: "full",
    summary: "Poll the status and result of an async (Job-mode) request. You may only read your own jobs.",
    params: [{ name: "job_id", type: "path string", required: true, description: "The id returned when the job was created." }],
    request: { kind: "none" },
    responseExample: `{
  "id": "clx...",
  "api": "Image Generation",
  "status": "Running",
  "progress": 62,
  "priority": 5,
  "result_path": null,
  "error": null,
  "created_at": "2026-06-14T10:00:00.000Z",
  "started_at": "2026-06-14T10:00:05.000Z",
  "completed_at": null
}`,
  },
  {
    category: "Core",
    apiName: "Jobs",
    name: "Cancel job",
    method: "POST",
    path: "/v1/jobs/{job_id}/cancel",
    mode: "Core",
    implemented: "full",
    summary: "Cancel a waiting or running job you own.",
    params: [{ name: "job_id", type: "path string", required: true, description: "The id of the job to cancel." }],
    request: { kind: "none" },
    responseExample: `{ "id": "clx...", "status": "Canceled" }`,
  },
];

// ---- Category-gated endpoints (shown only for categories you can access) ----

export const ENDPOINTS: EndpointDoc[] = [
  // ----- LLM -----
  {
    category: "LLM",
    apiName: "LLM Chat",
    name: "Chat completions",
    method: "POST",
    path: "/v1/chat/completions",
    mode: "Real-time",
    implemented: "full",
    summary: "OpenAI-compatible chat completion. Send a list of role/content messages and receive an assistant reply.",
    modelSelection:
      "Pick an LLM `id` from GET /v1/models. Use qwen3-8b for fast chat, qwen3-14b/qwen3-32b-4bit for higher quality, or qwen2.5-coder-14b for code.",
    params: [
      { name: "model", type: "string", required: true, description: "Model id, e.g. \"qwen3-8b\"." },
      { name: "messages", type: "array", required: true, description: "List of { role: \"system\"|\"user\"|\"assistant\", content: string }." },
      { name: "stream", type: "boolean", required: false, description: "Reserved for streaming; the mock backend returns a full response." },
      { name: "max_tokens", type: "integer", required: false, description: "Optional upper bound on generated tokens." },
    ],
    request: { kind: "json", body: { model: "qwen3-8b", messages: [{ role: "user", content: "Hello from the lab" }] } },
    responseExample: `{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "model": "qwen3-8b",
  "choices": [
    { "index": 0, "message": { "role": "assistant", "content": "..." }, "finish_reason": "stop" }
  ],
  "usage": { "prompt_tokens": 5, "completion_tokens": 42, "total_tokens": 47 }
}`,
  },
  {
    category: "LLM",
    apiName: "LLM RAG",
    name: "RAG query",
    method: "POST",
    path: "/v1/rag/query",
    mode: "Sync",
    implemented: "full",
    summary: "Retrieval-augmented document QA. Returns an answer plus the sources it used.",
    modelSelection: "Uses the configured RAG model (Qwen3 + embeddings). No model field required.",
    params: [
      { name: "query", type: "string", required: true, description: "The natural-language question." },
      { name: "top_k", type: "integer", required: false, description: "How many chunks to retrieve (default backend-defined)." },
    ],
    request: { kind: "json", body: { query: "Summarize the safety policy.", top_k: 5 } },
    responseExample: `{ "answer": "...", "sources": [] }`,
  },
  // ----- TTS -----
  {
    category: "TTS",
    apiName: "TTS",
    name: "Text to speech",
    method: "POST",
    path: "/v1/audio/speech",
    mode: "Sync",
    implemented: "full",
    summary: "Synthesize speech from text. Responds with binary audio (audio/wav).",
    modelSelection: "kokoro-82m for fast CPU synthesis; gpt-sovits for higher-quality voice cloning.",
    params: [
      { name: "model", type: "string", required: true, description: "TTS model id, e.g. \"kokoro-82m\"." },
      { name: "input", type: "string", required: true, description: "Text to synthesize." },
      { name: "voice", type: "string", required: false, description: "Optional voice preset." },
      { name: "format", type: "string", required: false, description: "Audio format (default wav)." },
    ],
    request: { kind: "json", body: { model: "kokoro-82m", input: "Hello from the lab", format: "wav" } },
    binaryResponse: true,
    responseExample: `(binary audio/wav body; header X-Audio-Duration-Ms gives the duration)`,
  },
  // ----- STT -----
  {
    category: "STT",
    apiName: "STT",
    name: "Transcriptions",
    method: "POST",
    path: "/v1/audio/transcriptions",
    mode: "Real-time",
    implemented: "full",
    summary: "Transcribe an uploaded audio file to text. Send the audio as multipart/form-data. The audio is never stored.",
    modelSelection: "faster-whisper-medium for fast transcription; faster-whisper-large-v3 for accuracy.",
    params: [
      { name: "file", type: "file", required: true, description: "Audio file (multipart field \"file\")." },
      { name: "model", type: "string", required: false, description: "STT model id." },
    ],
    request: { kind: "multipart", fields: { model: "faster-whisper-medium" }, files: [{ field: "file", example: "audio.wav" }] },
    responseExample: `{ "text": "..." }`,
    notes: "Mock backend: it validates that a file is present (missing file -> 400) and returns placeholder text. The audio is never read or stored.",
  },
  {
    category: "STT",
    apiName: "Speech Enhancement",
    name: "Speech enhancement",
    method: "POST",
    path: "/v1/audio/enhance",
    mode: "Sync",
    implemented: "skeleton",
    summary: "Denoise / enhance an uploaded audio file.",
    modelSelection: "deepfilternet (fast, CPU).",
    params: [
      { name: "file", type: "file", required: true, description: "Audio file to enhance." },
      { name: "model", type: "string", required: false, description: "Enhancement model id." },
    ],
    request: { kind: "multipart", fields: { model: "deepfilternet" }, files: [{ field: "file", example: "audio.wav" }] },
    responseExample: `{ "object": "mock", "api": "Speech Enhancement", "message": "..." }`,
  },
  {
    category: "STT",
    apiName: "Voice Conversion",
    name: "Voice conversion",
    method: "POST",
    path: "/v1/audio/voice-conversion",
    mode: "Sync",
    implemented: "skeleton",
    summary: "Convert a voice in an uploaded clip to a target voice.",
    modelSelection: "gpt-sovits.",
    params: [
      { name: "file", type: "file", required: true, description: "Source audio clip." },
      { name: "model", type: "string", required: false, description: "Voice conversion model id." },
      { name: "target_voice", type: "string", required: false, description: "Target voice/speaker id." },
    ],
    request: { kind: "multipart", fields: { model: "gpt-sovits", target_voice: "speaker1" }, files: [{ field: "file", example: "audio.wav" }] },
    responseExample: `{ "object": "mock", "api": "Voice Conversion", "message": "..." }`,
    notes: "This API is Offline by default in seed data; it returns 503 until started by an admin.",
  },
  // ----- Vision -----
  {
    category: "Vision",
    apiName: "Vision QA",
    name: "Vision chat (image QA)",
    method: "POST",
    path: "/v1/vision/chat",
    mode: "Sync",
    implemented: "skeleton",
    summary: "Ask a question about an image.",
    modelSelection: "qwen2.5-vl-7b (fast); qwen2.5-vl-32b for quality (admin-installed).",
    params: [
      { name: "file", type: "file", required: true, description: "Image file." },
      { name: "prompt", type: "string", required: true, description: "Question about the image." },
      { name: "model", type: "string", required: false, description: "Vision model id." },
    ],
    request: { kind: "multipart", fields: { model: "qwen2.5-vl-7b", prompt: "What is in this image?" }, files: [{ field: "file", example: "image.jpg" }] },
    responseExample: `{ "object": "mock", "api": "Vision QA", "message": "..." }`,
    notes: "Offline by default (on demand); returns 503 until started.",
  },
  {
    category: "Vision",
    apiName: "OCR",
    name: "OCR",
    method: "POST",
    path: "/v1/vision/ocr",
    mode: "Sync",
    implemented: "skeleton",
    summary: "Extract text from an image.",
    modelSelection: "paddleocr (PP-OCRv5).",
    params: [
      { name: "file", type: "file", required: true, description: "Image file." },
      { name: "model", type: "string", required: false, description: "OCR model id." },
    ],
    request: { kind: "multipart", fields: { model: "paddleocr" }, files: [{ field: "file", example: "image.jpg" }] },
    responseExample: `{ "object": "mock", "api": "OCR", "message": "..." }`,
  },
  {
    category: "Vision",
    apiName: "Object Detection",
    name: "Object detection",
    method: "POST",
    path: "/v1/vision/detect",
    mode: "Real-time",
    implemented: "skeleton",
    summary: "Detect objects in an image.",
    modelSelection: "yolo11s (fast).",
    params: [
      { name: "file", type: "file", required: true, description: "Image file." },
      { name: "model", type: "string", required: false, description: "Detector model id." },
    ],
    request: { kind: "multipart", fields: { model: "yolo11s" }, files: [{ field: "file", example: "image.jpg" }] },
    responseExample: `{ "object": "mock", "api": "Object Detection", "message": "..." }`,
  },
  {
    category: "Vision",
    apiName: "Segmentation",
    name: "Segmentation",
    method: "POST",
    path: "/v1/vision/segment",
    mode: "Job",
    implemented: "skeleton",
    summary: "Segment objects/regions in an image (Job mode).",
    modelSelection: "sam2 (admin-installed).",
    params: [{ name: "file", type: "file", required: true, description: "Image file." }],
    request: { kind: "multipart", fields: { model: "sam2" }, files: [{ field: "file", example: "image.jpg" }] },
    responseExample: `{ "job_id": "clx...", "status": "Waiting", "api": "Segmentation" }`,
    notes: "Not Installed by default; returns 404 until installed and Online.",
  },
  {
    category: "Vision",
    apiName: "Pose Estimation",
    name: "Pose estimation",
    method: "POST",
    path: "/v1/vision/pose",
    mode: "Real-time",
    implemented: "skeleton",
    summary: "Estimate human pose keypoints in an image.",
    modelSelection: "rtmpose.",
    params: [{ name: "file", type: "file", required: true, description: "Image file." }],
    request: { kind: "multipart", fields: { model: "rtmpose" }, files: [{ field: "file", example: "image.jpg" }] },
    responseExample: `{ "object": "mock", "api": "Pose Estimation", "message": "..." }`,
  },
  {
    category: "Vision",
    apiName: "Depth Estimation",
    name: "Depth estimation",
    method: "POST",
    path: "/v1/vision/depth",
    mode: "Sync",
    implemented: "skeleton",
    summary: "Estimate a depth map from a single image.",
    modelSelection: "depth-anything-v2.",
    params: [{ name: "file", type: "file", required: true, description: "Image file." }],
    request: { kind: "multipart", fields: { model: "depth-anything-v2" }, files: [{ field: "file", example: "image.jpg" }] },
    responseExample: `{ "object": "mock", "api": "Depth Estimation", "message": "..." }`,
  },
  // ----- Image -----
  {
    category: "Image",
    apiName: "Image Generation",
    name: "Image generation",
    method: "POST",
    path: "/v1/images/generations",
    mode: "Job",
    implemented: "full",
    summary: "Generate images from a text prompt. Heavy work runs as a Job: you get a job_id to poll with GET /v1/jobs/{id}.",
    modelSelection: "flux-schnell (fast); flux-dev (quality).",
    params: [
      { name: "model", type: "string", required: true, description: "Image model id." },
      { name: "prompt", type: "string", required: true, description: "Text prompt (never stored)." },
      { name: "size", type: "string", required: false, description: "e.g. \"1024x1024\"." },
      { name: "n", type: "integer", required: false, description: "Number of images (1-4)." },
    ],
    request: { kind: "json", body: { model: "flux-schnell", prompt: "a neon cyberpunk city at night", size: "1024x1024", n: 1 } },
    responseExample: `{ "job_id": "clx...", "status": "Waiting" }`,
    notes: "Not Installed by default; returns 404 until installed and Online. Then poll the job_id.",
  },
  {
    category: "Image",
    apiName: "Image Enhancement",
    name: "Image enhancement",
    method: "POST",
    path: "/v1/images/enhance",
    mode: "Sync",
    implemented: "skeleton",
    summary: "Upscale / restore an image.",
    modelSelection: "real-esrgan.",
    params: [
      { name: "file", type: "file", required: true, description: "Image to enhance." },
      { name: "scale", type: "string", required: false, description: "Upscale factor, e.g. \"4\"." },
    ],
    request: { kind: "multipart", fields: { model: "real-esrgan", scale: "4" }, files: [{ field: "file", example: "image.jpg" }] },
    responseExample: `{ "object": "mock", "api": "Image Enhancement", "message": "..." }`,
  },
  {
    category: "Image",
    apiName: "Background Removal",
    name: "Background removal",
    method: "POST",
    path: "/v1/images/remove-background",
    mode: "Sync",
    implemented: "skeleton",
    summary: "Remove the background from an image.",
    modelSelection: "rembg (ISNet).",
    params: [{ name: "file", type: "file", required: true, description: "Image file." }],
    request: { kind: "multipart", fields: { model: "rembg" }, files: [{ field: "file", example: "image.jpg" }] },
    responseExample: `{ "object": "mock", "api": "Background Removal", "message": "..." }`,
  },
  // ----- Video -----
  {
    category: "Video",
    apiName: "Video Understanding",
    name: "Video understanding (job)",
    method: "POST",
    path: "/v1/video/understanding/jobs",
    mode: "Job",
    implemented: "skeleton",
    summary: "Analyze a video and answer questions about it (Job mode).",
    modelSelection: "Sampled frames + Qwen2.5-VL; LLaVA-OneVision for quality.",
    params: [
      { name: "file", type: "file", required: true, description: "Video file." },
      { name: "prompt", type: "string", required: true, description: "What to analyze." },
    ],
    request: { kind: "multipart", fields: { model: "video-understanding-vl", prompt: "Describe what happens." }, files: [{ field: "file", example: "video.mp4" }] },
    responseExample: `{ "job_id": "clx...", "status": "Waiting", "api": "Video Understanding" }`,
    notes: "Not Installed by default; returns 404 until installed and Online.",
  },
  {
    category: "Video",
    apiName: "Lip Sync",
    name: "Lip sync (job)",
    method: "POST",
    path: "/v1/video/lip-sync/jobs",
    mode: "Job",
    implemented: "skeleton",
    summary: "Generate a lip-synced video from a face video plus an audio track (Job mode).",
    modelSelection: "musetalk is the only seeded lip-sync model. Higher-quality options (Wav2Lip, SadTalker) are candidates an admin must install first.",
    params: [
      { name: "video", type: "file", required: true, description: "Face video." },
      { name: "audio", type: "file", required: true, description: "Audio track." },
    ],
    request: { kind: "multipart", fields: { model: "musetalk" }, files: [{ field: "video", example: "face.mp4" }, { field: "audio", example: "audio.wav" }] },
    responseExample: `{ "job_id": "clx...", "status": "Waiting", "api": "Lip Sync" }`,
    notes: "Not Installed by default; returns 404 until installed and Online.",
  },
  // ----- Motion -----
  {
    category: "Motion",
    apiName: "Motion Generation",
    name: "Motion generation",
    method: "POST",
    path: "/v1/motion/generate",
    mode: "Sync",
    implemented: "full",
    summary: "English text -> MMD body motion. Returns a binary .vmd (application/octet-stream) ready to play on an MMD model. Body-only (no face/fingers); global movement is discarded (in-place).",
    modelSelection: "hy-motion-1 (Tencent HY-Motion 1.0). Served by the motion-service backend.",
    params: [
      { name: "prompt", type: "string", required: false, description: "English motion instruction (< 30 words, <= 5 s). Required unless `emotion` is given." },
      { name: "emotion", type: "string", required: false, description: "One of neutral|happy|sad|thinking|surprised|angry|shy (uses a preset prompt)." },
      { name: "duration", type: "number", required: false, description: "Clip length in seconds (<= 5)." },
      { name: "seed", type: "number", required: false, description: "Generation seed." },
    ],
    request: { kind: "json", body: { prompt: "a person waving hello", duration: 4, seed: 1 } },
    responseExample: `<binary .vmd> (Content-Type: application/octet-stream)`,
    notes: "Also: GET /v1/motion/pool/{emotion} returns an instant pre-generated .vmd (503 if not warm yet).",
  },
  {
    category: "Motion",
    apiName: "Robot Motion",
    name: "Robot motion command",
    method: "POST",
    path: "/v1/robot-motion/commands",
    mode: "Real-time",
    implemented: "skeleton",
    summary: "Send a motion command to the robot controller.",
    modelSelection: "Custom preset controller (fast); LLM motion planner for quality.",
    params: [
      { name: "command", type: "string", required: true, description: "Command name, e.g. \"move_forward\"." },
      { name: "params", type: "object", required: false, description: "Command parameters." },
    ],
    request: { kind: "json", body: { command: "move_forward", params: { distance_m: 0.5, speed: 0.3 } } },
    responseExample: `{ "object": "mock", "api": "Robot Motion", "message": "..." }`,
    notes: "Controller is in an Error state in seed data; returns 503 until restarted.",
  },
];

// ---- Error reference (mirrors src/lib/gateway.ts ERRORS) ----

export const ERROR_REFERENCE: { status: number; code: string; message: string; when: string }[] = [
  { status: 400, code: "bad_request", message: "Invalid request format.", when: "Body failed validation (missing/invalid fields)." },
  { status: 401, code: "invalid_api_key", message: "Invalid API key.", when: "Missing/disabled/unknown Bearer key." },
  { status: 403, code: "access_denied", message: "You do not have access to this API.", when: "Your account lacks access to that category, or the account is disabled." },
  { status: 404, code: "not_found", message: "The requested resource was not found.", when: "Unknown endpoint, or the API is Not Installed." },
  { status: 408, code: "timeout", message: "The request timed out.", when: "The request exceeded its time budget." },
  { status: 409, code: "conflict", message: "The request conflicts with the current system state.", when: "e.g. cancelling an already-finished job." },
  { status: 429, code: "rate_limited", message: "Too many requests. Please try again later.", when: "Too many invalid key attempts from your IP, or throttling." },
  { status: 500, code: "internal", message: "Internal server error.", when: "Unexpected server error." },
  { status: 502, code: "backend_error", message: "The backend service returned an error.", when: "The model backend failed." },
  { status: 503, code: "unavailable", message: "This API is temporarily unavailable.", when: "API is Offline / Error / Disabled." },
  { status: 503, code: "maintenance", message: "The system is currently under maintenance. Please try again later.", when: "Maintenance Mode is On (normal users only)." },
  { status: 504, code: "backend_timeout", message: "The backend service timed out.", when: "The backend did not respond in time." },
  { status: 507, code: "gpu_full", message: "The GPU is very busy. Please try again later.", when: "No GPU capacity for the request." },
];
