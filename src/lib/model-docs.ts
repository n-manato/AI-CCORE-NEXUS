// Per-model documentation for every model in the registry (installed or not).
//
// Kept as static data (not in the DB) so adding docs needs no migration/re-seed.
// `modelId` keys must match prisma/seed.ts MODELS. `endpoint` is the primary path
// used to call the model; the page joins this with live registry status.

import { ENDPOINTS, CORE_ENDPOINTS, toCurl, type EndpointDoc } from "@/lib/api-docs";

export interface ModelDoc {
  summary: string; // what it is / does
  whenToUse: string; // selection guidance
  endpoint: string; // primary endpoint path
  notes?: string; // caveats (2GPU, not installed, etc.)
}

export const MODEL_DOCS: Record<string, ModelDoc> = {
  // ---- LLM ----
  "qwen3-8b": {
    summary: "Fast general-purpose chat/instruction LLM. The lab's default for interactive use.",
    whenToUse: "Chatbots, summarization, quick Q&A, drafting. First choice when latency matters.",
    endpoint: "/v1/chat/completions",
    notes: "Always Running, fits one 24GB GPU.",
  },
  "qwen3-14b": {
    summary: "Higher-quality chat LLM with stronger reasoning than 8B, still on a single GPU.",
    whenToUse: "When 8B's answers aren't good enough but you want single-GPU latency.",
    endpoint: "/v1/chat/completions",
    notes: "On Demand (cold start on first call).",
  },
  "qwen3-32b-4bit": {
    summary: "Top-quality chat LLM (4-bit) that spans both GPUs.",
    whenToUse: "Hardest reasoning / long-context tasks where quality beats speed.",
    endpoint: "/v1/chat/completions",
    notes: "2GPU — uses GPU0 + GPU1; On Demand.",
  },
  "qwen2.5-coder-14b": {
    summary: "Fast code-specialized LLM for generation, completion, and review.",
    whenToUse: "Coding assistants, refactors, code explanation. Use this for code over qwen3 chat.",
    endpoint: "/v1/chat/completions",
    notes: "On Demand, single GPU.",
  },
  "qwen2.5-coder-32b": {
    summary: "Highest-quality coding LLM, spans both GPUs.",
    whenToUse: "Complex, multi-file code tasks needing the best quality.",
    endpoint: "/v1/chat/completions",
    notes: "2GPU. Not installed by default — an admin must install it first.",
  },
  "gemma-3-27b": {
    summary: "Alternative high-quality chat LLM (Gemma family), spans both GPUs.",
    whenToUse: "When you want a non-Qwen second opinion for chat/reasoning.",
    endpoint: "/v1/chat/completions",
    notes: "2GPU. Not installed / disabled by default.",
  },

  // ---- Audio ----
  "kokoro-82m": {
    summary: "Lightweight text-to-speech that runs on CPU with low latency.",
    whenToUse: "Default TTS for notifications, short utterances, real-time speech.",
    endpoint: "/v1/audio/speech",
    notes: "CPU (no VRAM). Returns audio/wav.",
  },
  "gpt-sovits": {
    summary: "High-quality / voice-cloning TTS.",
    whenToUse: "Natural-sounding or custom-voice speech where quality matters.",
    endpoint: "/v1/audio/speech",
    notes: "1GPU, On Demand. Also backs voice conversion.",
  },
  "xtts-v2": {
    summary: "Multilingual high-quality TTS with voice cloning.",
    whenToUse: "Multilingual or cloned-voice synthesis.",
    endpoint: "/v1/audio/speech",
    notes: "Not installed by default.",
  },
  "faster-whisper-medium": {
    summary: "Balanced speech-to-text (good speed + accuracy).",
    whenToUse: "Default transcription for meetings, voice notes, real-time captions.",
    endpoint: "/v1/audio/transcriptions",
    notes: "Send audio as multipart 'file'. Always Running.",
  },
  "faster-whisper-large-v3": {
    summary: "Most accurate speech-to-text (slower, more VRAM).",
    whenToUse: "Hard audio: accents, noise, domain terms, when accuracy is critical.",
    endpoint: "/v1/audio/transcriptions",
    notes: "On Demand.",
  },
  deepfilternet: {
    summary: "Speech enhancement / denoiser that cleans up noisy audio.",
    whenToUse: "Pre-process noisy recordings before transcription, or clean calls.",
    endpoint: "/v1/audio/enhance",
    notes: "CPU.",
  },

  // ---- Vision ----
  "qwen2.5-vl-7b": {
    summary: "Vision-language model: answer questions about an image.",
    whenToUse: "Image Q&A, captioning, reading charts/screenshots.",
    endpoint: "/v1/vision/chat",
    notes: "Send the image as a multipart file (NOT chat content arrays). On Demand.",
  },
  "qwen2.5-vl-32b": {
    summary: "Higher-quality vision-language model, spans both GPUs.",
    whenToUse: "Detailed visual reasoning where the 7B is not enough.",
    endpoint: "/v1/vision/chat",
    notes: "2GPU. Not installed by default.",
  },
  paddleocr: {
    summary: "OCR engine (PP-OCRv5) that extracts text from images.",
    whenToUse: "Scanned docs, screenshots, receipts, any image-to-text.",
    endpoint: "/v1/vision/ocr",
    notes: "CPU.",
  },
  yolo11s: {
    summary: "Fast object detector (bounding boxes + classes).",
    whenToUse: "Real-time detection, counting objects, simple monitoring.",
    endpoint: "/v1/vision/detect",
    notes: "Always Running, real-time.",
  },
  sam2: {
    summary: "Segment Anything 2 — produces precise object/region masks.",
    whenToUse: "Segmentation, cut-outs, masking specific objects.",
    endpoint: "/v1/vision/segment",
    notes: "Job mode. Not installed by default.",
  },
  rtmpose: {
    summary: "Human pose estimation (body keypoints/skeleton).",
    whenToUse: "Posture, gesture, motion capture, sports/exercise analysis.",
    endpoint: "/v1/vision/pose",
    notes: "Always Running, real-time.",
  },
  "depth-anything-v2": {
    summary: "Monocular depth estimation (depth map from a single image).",
    whenToUse: "3D hints, background blur, robotics/scene understanding.",
    endpoint: "/v1/vision/depth",
    notes: "On Demand, single GPU.",
  },

  // ---- Image ----
  "flux-schnell": {
    summary: "Fast text-to-image generation.",
    whenToUse: "Quick image generation / iterating on prompts.",
    endpoint: "/v1/images/generations",
    notes: "Job mode — returns a job_id to poll. Not installed by default.",
  },
  "flux-dev": {
    summary: "Higher-quality text-to-image generation.",
    whenToUse: "Final, high-fidelity images where quality beats speed.",
    endpoint: "/v1/images/generations",
    notes: "Job mode. Not installed by default.",
  },
  "real-esrgan": {
    summary: "Image upscaler / restorer (super-resolution).",
    whenToUse: "Enlarge or clean up low-res images and photos.",
    endpoint: "/v1/images/enhance",
    notes: "Single GPU, On Demand.",
  },
  rembg: {
    summary: "Background removal (ISNet).",
    whenToUse: "Cut subjects out of photos, make transparent PNGs.",
    endpoint: "/v1/images/remove-background",
    notes: "CPU.",
  },

  // ---- Video ----
  "video-understanding-vl": {
    summary: "Video understanding via sampled frames + a VLM.",
    whenToUse: "Summarize/describe/Q&A over a video clip.",
    endpoint: "/v1/video/understanding/jobs",
    notes: "Job mode. Not installed by default.",
  },
  "llava-onevision": {
    summary: "Higher-quality video understanding model, spans both GPUs.",
    whenToUse: "Detailed video analysis where the fast option is not enough.",
    endpoint: "/v1/video/understanding/jobs",
    notes: "2GPU, Job mode. Not installed by default.",
  },
  musetalk: {
    summary: "Lip-sync: align a face video to an audio track.",
    whenToUse: "Dubbing, talking-head avatars, lip-synced clips.",
    endpoint: "/v1/video/lip-sync/jobs",
    notes: "Job mode (needs a video + an audio file). Not installed by default.",
  },

  // ---- Motion ----
  "rule-motion": {
    summary: "Rule-based motion generation from presets + a small LLM.",
    whenToUse: "Simple, predictable motion sequences from a text instruction.",
    endpoint: "/v1/motion/generate",
    notes: "CPU. The model is selected server-side (no model field needed).",
  },
  motiongpt: {
    summary: "Learned motion generation (MotionGPT) for richer sequences.",
    whenToUse: "More natural/complex generated motion.",
    endpoint: "/v1/motion/generate",
    notes: "Job mode. Not installed by default.",
  },
  "robot-controller": {
    summary: "Custom preset controller that turns commands into robot motion.",
    whenToUse: "Send discrete robot commands (move, turn, etc.).",
    endpoint: "/v1/robot-motion/commands",
    notes: "CPU, real-time. Command-based (no model field needed).",
  },
};

// Builds a cURL example for a specific model id on its endpoint, reusing the
// endpoint's request spec (so JSON vs multipart stays correct).
function epForPath(path: string): EndpointDoc | undefined {
  return [...ENDPOINTS, ...CORE_ENDPOINTS].find((e) => e.path === path);
}

export function modelCurl(base: string, modelId: string, path: string): string {
  const ep = epForPath(path);
  if (!ep) return "";
  let withModel: EndpointDoc = ep;
  if (ep.request.kind === "json" && "model" in ep.request.body) {
    withModel = { ...ep, request: { ...ep.request, body: { ...ep.request.body, model: modelId } } };
  } else if (ep.request.kind === "multipart" && "model" in ep.request.fields) {
    withModel = { ...ep, request: { ...ep.request, fields: { ...ep.request.fields, model: modelId } } };
  }
  return toCurl(base, withModel);
}
