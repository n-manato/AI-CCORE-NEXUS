// Seed script for local development.
//
// Self-contained on purpose: it only imports @prisma/client, bcryptjs and Node's
// crypto so it can run via `tsx` without TS path-alias resolution. Demo accounts
// and data are for LOCAL DEVELOPMENT ONLY.
//
// Run with:  npm run db:seed   (or the combined  npm run setup)

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// ---- Minimal .env loader (avoids a dotenv dependency) ----
function loadEnv() {
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

const prisma = new PrismaClient();

// ---- Inline crypto (mirrors src/lib/crypto.ts + apikey.ts) ----
function encKey(): Buffer {
  const hex = process.env.API_KEY_ENC_KEY ?? "";
  if (hex.length !== 64) {
    throw new Error("API_KEY_ENC_KEY must be 64 hex chars. Copy .env.example to .env.");
  }
  return Buffer.from(hex, "hex");
}
function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}
function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
function genKey() {
  const raw = `lag_${crypto.randomBytes(24).toString("base64url")}`;
  return {
    raw,
    keyHash: hashKey(raw),
    keyEncrypted: encryptSecret(raw),
    keyPrefix: raw.slice(0, 8),
    last4: raw.slice(-4),
  };
}

const CATEGORIES = ["LLM", "TTS", "STT", "Image", "Vision", "Video", "Motion"] as const;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

// ---- Model registry data ----
interface ModelSeed {
  modelId: string;
  category: string;
  function: string;
  modelName: string;
  backend: string;
  installed: boolean;
  vmin: number;
  vmax: number;
  rule: string; // default_device_rule
  multi: boolean;
  policy: string; // startup policy
  runtime: string; // runtime type
  size: string; // size class
  enabled: boolean;
  maxConcurrent: number;
  autoShutdown: number;
  state: string; // current status
}

const MODELS: ModelSeed[] = [
  // --- LLM ---
  { modelId: "qwen3-8b", category: "LLM", function: "Chat fast", modelName: "Qwen3-8B", backend: "vLLM", installed: true, vmin: 14, vmax: 16, rule: "1GPU", multi: false, policy: "Always Running", runtime: "Real-time", size: "Medium", enabled: true, maxConcurrent: 2, autoShutdown: 0, state: "Running" },
  { modelId: "qwen3-14b", category: "LLM", function: "Chat quality", modelName: "Qwen3-14B", backend: "vLLM", installed: true, vmin: 18, vmax: 20, rule: "1GPU", multi: false, policy: "On Demand", runtime: "Real-time", size: "Large", enabled: false, maxConcurrent: 2, autoShutdown: 20, state: "Stopped" },
  { modelId: "qwen3-32b-4bit", category: "LLM", function: "Chat quality", modelName: "Qwen3-32B 4bit", backend: "vLLM", installed: true, vmin: 20, vmax: 22, rule: "1GPU", multi: false, policy: "On Demand", runtime: "Sync", size: "XLarge", enabled: false, maxConcurrent: 1, autoShutdown: 30, state: "Stopped" },
  { modelId: "qwen2.5-coder-14b", category: "LLM", function: "Code fast", modelName: "Qwen2.5-Coder 14B", backend: "vLLM", installed: true, vmin: 18, vmax: 20, rule: "1GPU", multi: false, policy: "On Demand", runtime: "Real-time", size: "Large", enabled: false, maxConcurrent: 1, autoShutdown: 20, state: "Stopped" },
  { modelId: "qwen2.5-coder-32b", category: "LLM", function: "Code quality", modelName: "Qwen2.5-Coder 32B", backend: "vLLM", installed: false, vmin: 20, vmax: 22, rule: "2GPU", multi: true, policy: "On Demand", runtime: "Sync", size: "XLarge", enabled: false, maxConcurrent: 1, autoShutdown: 30, state: "Stopped" },
  { modelId: "qwen3-coder-30b", category: "LLM", function: "Code agentic (MoE 30B-A3B)", modelName: "Qwen3-Coder 30B A3B", backend: "Ollama", installed: false, vmin: 30, vmax: 33, rule: "2GPU", multi: true, policy: "On Demand", runtime: "Real-time", size: "XLarge", enabled: false, maxConcurrent: 6, autoShutdown: 30, state: "Stopped" },
  { modelId: "qwen3.6-35b", category: "LLM", function: "Code agentic (MoE 35B-A3B)", modelName: "Qwen3.6 35B A3B (Q6_K)", backend: "Ollama", installed: false, vmin: 31, vmax: 33, rule: "2GPU", multi: true, policy: "On Demand", runtime: "Real-time", size: "XLarge", enabled: true, maxConcurrent: 6, autoShutdown: 30, state: "Stopped" },
  { modelId: "qwen3-coder-next", category: "LLM", function: "Code agentic (Qwen3-Next 80B-A3B, non-reasoning)", modelName: "Qwen3-Coder-Next 80B A3B", backend: "Ollama", installed: false, vmin: 42, vmax: 44, rule: "2GPU", multi: true, policy: "Always Running", runtime: "Real-time", size: "XLarge", enabled: true, maxConcurrent: 2, autoShutdown: 0, state: "Stopped" },
  { modelId: "qwen3.6-27b", category: "LLM", function: "Reasoning + vision (dense 27B)", modelName: "Qwen3.6 27B (Q8_0)", backend: "Ollama", installed: false, vmin: 29, vmax: 32, rule: "2GPU", multi: true, policy: "On Demand", runtime: "Real-time", size: "XLarge", enabled: false, maxConcurrent: 6, autoShutdown: 30, state: "Stopped" },
  { modelId: "devstral-small-2", category: "LLM", function: "Agentic coding (Mistral dense 24B)", modelName: "Devstral Small 2 24B (Q8_0)", backend: "Ollama", installed: false, vmin: 25, vmax: 43, rule: "2GPU", multi: true, policy: "Always Running", runtime: "Real-time", size: "Large", enabled: true, maxConcurrent: 6, autoShutdown: 0, state: "Stopped" },
  { modelId: "glm-4.7-flash", category: "LLM", function: "Code agentic (GLM-4.7-Flash MoE 30B-A3B)", modelName: "GLM-4.7-Flash (Q8_0)", backend: "Ollama", installed: false, vmin: 31, vmax: 40, rule: "2GPU", multi: true, policy: "On Demand", runtime: "Real-time", size: "XLarge", enabled: true, maxConcurrent: 4, autoShutdown: 30, state: "Stopped" },
  { modelId: "deepseek-r1-70b", category: "LLM", function: "Reasoning (2GPU)", modelName: "DeepSeek-R1 70B", backend: "Ollama", installed: false, vmin: 42, vmax: 45, rule: "2GPU", multi: true, policy: "On Demand", runtime: "Sync", size: "XLarge", enabled: true, maxConcurrent: 1, autoShutdown: 30, state: "Stopped" },

  // --- Audio ---
  { modelId: "kokoro-82m", category: "TTS", function: "TTS fast", modelName: "Kokoro-82M", backend: "Kokoro", installed: true, vmin: 0, vmax: 1, rule: "CPU", multi: false, policy: "Always Running", runtime: "Sync", size: "Small", enabled: true, maxConcurrent: 3, autoShutdown: 0, state: "Running" },
  { modelId: "gpt-sovits", category: "TTS", function: "TTS quality", modelName: "GPT-SoVITS", backend: "GPT-SoVITS", installed: true, vmin: 3, vmax: 4, rule: "1GPU", multi: false, policy: "On Demand", runtime: "Sync", size: "Medium", enabled: true, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },
  { modelId: "xtts-v2", category: "TTS", function: "TTS quality", modelName: "XTTS-v2", backend: "Coqui", installed: false, vmin: 3, vmax: 4, rule: "1GPU", multi: false, policy: "On Demand", runtime: "Sync", size: "Medium", enabled: false, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },
  { modelId: "faster-whisper-medium", category: "STT", function: "STT fast", modelName: "faster-whisper medium", backend: "faster-whisper", installed: true, vmin: 2, vmax: 3, rule: "1GPU", multi: false, policy: "Always Running", runtime: "Real-time", size: "Small", enabled: true, maxConcurrent: 2, autoShutdown: 0, state: "Running" },
  { modelId: "faster-whisper-large-v3", category: "STT", function: "STT quality", modelName: "faster-whisper large-v3", backend: "faster-whisper", installed: true, vmin: 5, vmax: 6, rule: "1GPU", multi: false, policy: "On Demand", runtime: "Real-time", size: "Medium", enabled: false, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },
  { modelId: "deepfilternet", category: "STT", function: "Speech enhancement fast", modelName: "DeepFilterNet", backend: "DeepFilterNet", installed: true, vmin: 0, vmax: 1, rule: "CPU", multi: false, policy: "Always Running", runtime: "Sync", size: "Small", enabled: true, maxConcurrent: 2, autoShutdown: 0, state: "Running" },

  // --- Vision ---
  { modelId: "qwen2.5-vl-7b", category: "Vision", function: "Vision QA fast", modelName: "Qwen2.5-VL-7B", backend: "vLLM", installed: true, vmin: 14, vmax: 16, rule: "1GPU", multi: false, policy: "On Demand", runtime: "Sync", size: "Medium", enabled: false, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },
  { modelId: "qwen2.5-vl-32b", category: "Vision", function: "Vision QA quality", modelName: "Qwen2.5-VL-32B", backend: "vLLM", installed: false, vmin: 21, vmax: 23, rule: "1GPU", multi: false, policy: "On Demand", runtime: "Sync", size: "XLarge", enabled: false, maxConcurrent: 1, autoShutdown: 30, state: "Stopped" },
  { modelId: "paddleocr", category: "Vision", function: "OCR fast", modelName: "PP-OCRv5", backend: "PaddleOCR", installed: true, vmin: 0, vmax: 2, rule: "CPU", multi: false, policy: "On Demand", runtime: "Sync", size: "Small", enabled: true, maxConcurrent: 2, autoShutdown: 15, state: "Stopped" },
  { modelId: "yolo11s", category: "Vision", function: "Object detection fast", modelName: "YOLO11s", backend: "Ultralytics", installed: true, vmin: 1, vmax: 2, rule: "1GPU", multi: false, policy: "Always Running", runtime: "Real-time", size: "Small", enabled: true, maxConcurrent: 1, autoShutdown: 0, state: "Running" },
  { modelId: "sam2", category: "Vision", function: "Segmentation quality", modelName: "SAM 2", backend: "SAM2", installed: false, vmin: 6, vmax: 8, rule: "1GPU", multi: false, policy: "Job Queue", runtime: "Job", size: "Medium", enabled: false, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },
  { modelId: "rtmpose", category: "Vision", function: "Pose estimation fast", modelName: "RTMPose", backend: "MMPose", installed: true, vmin: 1, vmax: 2, rule: "1GPU", multi: false, policy: "Always Running", runtime: "Real-time", size: "Small", enabled: true, maxConcurrent: 1, autoShutdown: 0, state: "Running" },
  { modelId: "depth-anything-v2", category: "Vision", function: "Depth estimation fast", modelName: "Depth Anything V2 Base", backend: "DepthAnything", installed: true, vmin: 1, vmax: 2, rule: "1GPU", multi: false, policy: "On Demand", runtime: "Sync", size: "Small", enabled: true, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },

  // --- Image ---
  { modelId: "flux-schnell", category: "Image", function: "Image generation fast", modelName: "FLUX.1-schnell", backend: "ComfyUI", installed: false, vmin: 12, vmax: 16, rule: "1GPU", multi: false, policy: "Job Queue", runtime: "Job", size: "Large", enabled: false, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },
  { modelId: "flux-dev", category: "Image", function: "Image generation quality", modelName: "FLUX.1-dev", backend: "ComfyUI", installed: false, vmin: 20, vmax: 24, rule: "1GPU", multi: false, policy: "Job Queue", runtime: "Job", size: "Large", enabled: false, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },
  { modelId: "real-esrgan", category: "Image", function: "Image enhancement fast", modelName: "Real-ESRGAN", backend: "Real-ESRGAN", installed: true, vmin: 1, vmax: 2, rule: "1GPU", multi: false, policy: "On Demand", runtime: "Sync", size: "Small", enabled: true, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },
  { modelId: "rembg", category: "Image", function: "Background removal fast", modelName: "rembg (ISNet)", backend: "rembg", installed: true, vmin: 0, vmax: 1, rule: "CPU", multi: false, policy: "On Demand", runtime: "Sync", size: "Small", enabled: true, maxConcurrent: 2, autoShutdown: 15, state: "Stopped" },

  // --- Video ---
  { modelId: "video-understanding-vl", category: "Video", function: "Video understanding", modelName: "Qwen2.5-VL-7B (sampled frames)", backend: "vLLM", installed: false, vmin: 16, vmax: 20, rule: "1GPU", multi: false, policy: "Job Queue", runtime: "Job", size: "Large", enabled: false, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },
  { modelId: "llava-onevision", category: "Video", function: "Video understanding quality", modelName: "LLaVA-OneVision", backend: "vLLM", installed: false, vmin: 26, vmax: 32, rule: "2GPU", multi: true, policy: "Job Queue", runtime: "Job", size: "XLarge", enabled: false, maxConcurrent: 1, autoShutdown: 30, state: "Stopped" },
  { modelId: "musetalk", category: "Video", function: "Lip sync fast", modelName: "MuseTalk", backend: "MuseTalk", installed: false, vmin: 6, vmax: 8, rule: "1GPU", multi: false, policy: "Job Queue", runtime: "Job", size: "Medium", enabled: false, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },

  // --- Motion ---
  { modelId: "rule-motion", category: "Motion", function: "Motion generation fast", modelName: "Rule-based presets + small LLM", backend: "Custom", installed: true, vmin: 0, vmax: 1, rule: "CPU", multi: false, policy: "On Demand", runtime: "Sync", size: "Small", enabled: false, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },
  { modelId: "motiongpt", category: "Motion", function: "Motion generation quality", modelName: "MotionGPT", backend: "MotionGPT", installed: false, vmin: 8, vmax: 10, rule: "1GPU", multi: false, policy: "Job Queue", runtime: "Job", size: "Medium", enabled: false, maxConcurrent: 1, autoShutdown: 15, state: "Stopped" },
  { modelId: "robot-controller", category: "Motion", function: "Robot motion fast", modelName: "Custom preset controller", backend: "Custom", installed: true, vmin: 0, vmax: 0, rule: "CPU", multi: false, policy: "On Demand", runtime: "Real-time", size: "Small", enabled: false, maxConcurrent: 1, autoShutdown: 15, state: "Error" },
  { modelId: "hy-motion-1", category: "Motion", function: "Text→3D body motion (SMPL→VMD)", modelName: "HY-Motion 1.0", backend: "HY-Motion", installed: true, vmin: 20, vmax: 23, rule: "1GPU", multi: false, policy: "On Demand", runtime: "Sync", size: "Large", enabled: false, maxConcurrent: 1, autoShutdown: 0, state: "Stopped" },
];

function devicePlan(m: ModelSeed): string {
  if (!m.installed) return "Not Installed";
  if (m.rule === "Disabled") return "Disabled";
  return m.rule;
}

// ---- API status data ----
interface ApiSeed {
  apiName: string;
  category: string;
  status: string;
  model: string | null;
  backend: string | null;
  mode: string;
  usesGpu: boolean;
  queue: number;
  running: number;
  avg: number;
  errors: number;
  description: string;
}

const APIS: ApiSeed[] = [
  { apiName: "LLM Chat", category: "LLM", status: "Online", model: "Qwen3-8B", backend: "vLLM", mode: "Real-time", usesGpu: true, queue: 1, running: 1, avg: 430, errors: 2, description: "OpenAI-compatible chat completions." },
  { apiName: "LLM RAG", category: "LLM", status: "Online", model: "Qwen3-8B + bge-m3", backend: "vLLM", mode: "Sync", usesGpu: true, queue: 0, running: 0, avg: 1300, errors: 1, description: "Retrieval-augmented document QA." },
  { apiName: "TTS", category: "TTS", status: "Online", model: "Kokoro-82M", backend: "Kokoro", mode: "Sync", usesGpu: false, queue: 0, running: 0, avg: 320, errors: 0, description: "Text to speech." },
  { apiName: "STT", category: "STT", status: "Online", model: "faster-whisper medium", backend: "faster-whisper", mode: "Real-time", usesGpu: true, queue: 0, running: 1, avg: 650, errors: 0, description: "Speech to text transcription." },
  { apiName: "Speech Enhancement", category: "STT", status: "Online", model: "DeepFilterNet", backend: "DeepFilterNet", mode: "Sync", usesGpu: false, queue: 0, running: 0, avg: 280, errors: 0, description: "Noise reduction / speech enhancement." },
  { apiName: "Voice Conversion", category: "STT", status: "Offline", model: "GPT-SoVITS", backend: "GPT-SoVITS", mode: "Sync", usesGpu: true, queue: 0, running: 0, avg: 0, errors: 0, description: "Voice conversion (on demand)." },
  { apiName: "Vision QA", category: "Vision", status: "Offline", model: "Qwen2.5-VL-7B", backend: "vLLM", mode: "Sync", usesGpu: true, queue: 0, running: 0, avg: 0, errors: 0, description: "Image question answering (on demand)." },
  { apiName: "OCR", category: "Vision", status: "Online", model: "PP-OCRv5", backend: "PaddleOCR", mode: "Sync", usesGpu: false, queue: 0, running: 0, avg: 410, errors: 0, description: "Optical character recognition." },
  { apiName: "Object Detection", category: "Vision", status: "Online", model: "YOLO11s", backend: "Ultralytics", mode: "Real-time", usesGpu: true, queue: 0, running: 1, avg: 35, errors: 0, description: "Object detection." },
  { apiName: "Segmentation", category: "Vision", status: "Not Installed", model: null, backend: "SAM2", mode: "Job", usesGpu: true, queue: 0, running: 0, avg: 0, errors: 0, description: "Image segmentation (not installed)." },
  { apiName: "Pose Estimation", category: "Vision", status: "Online", model: "RTMPose", backend: "MMPose", mode: "Real-time", usesGpu: true, queue: 0, running: 0, avg: 28, errors: 0, description: "Human pose estimation." },
  { apiName: "Depth Estimation", category: "Vision", status: "Online", model: "Depth Anything V2 Base", backend: "DepthAnything", mode: "Sync", usesGpu: true, queue: 0, running: 0, avg: 240, errors: 0, description: "Monocular depth estimation." },
  { apiName: "Image Generation", category: "Image", status: "Not Installed", model: null, backend: "ComfyUI", mode: "Job", usesGpu: true, queue: 0, running: 0, avg: 0, errors: 0, description: "Text to image generation (not installed)." },
  { apiName: "Image Enhancement", category: "Image", status: "Online", model: "Real-ESRGAN", backend: "Real-ESRGAN", mode: "Sync", usesGpu: true, queue: 0, running: 0, avg: 900, errors: 0, description: "Image upscaling / restoration." },
  { apiName: "Background Removal", category: "Image", status: "Online", model: "rembg (ISNet)", backend: "rembg", mode: "Sync", usesGpu: false, queue: 0, running: 0, avg: 360, errors: 0, description: "Background removal." },
  { apiName: "Video Understanding", category: "Video", status: "Not Installed", model: null, backend: "vLLM", mode: "Job", usesGpu: true, queue: 0, running: 0, avg: 0, errors: 0, description: "Video understanding job (not installed)." },
  { apiName: "Lip Sync", category: "Video", status: "Not Installed", model: null, backend: "MuseTalk", mode: "Job", usesGpu: true, queue: 0, running: 0, avg: 0, errors: 0, description: "Lip sync video job (not installed)." },
  { apiName: "Motion Generation", category: "Motion", status: "Offline", model: "HY-Motion 1.0", backend: "HY-Motion", mode: "Sync", usesGpu: true, queue: 0, running: 0, avg: 0, errors: 0, description: "English text → MMD .vmd body motion (HY-Motion 1.0)." },
  { apiName: "Robot Motion", category: "Motion", status: "Error", model: "Custom preset controller", backend: "Custom", mode: "Real-time", usesGpu: false, queue: 0, running: 0, avg: 0, errors: 3, description: "Robot motion controller (backend error)." },
];

async function clearAll() {
  // Delete in FK-safe order.
  await prisma.vramForecastSnapshot.deleteMany();
  await prisma.modelRuntimeState.deleteMany();
  await prisma.modelRuntimeConfig.deleteMany();
  await prisma.modelRegistry.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  await prisma.job.deleteMany();
  await prisma.usageLog.deleteMany();
  await prisma.apiStatus.deleteMany();
  await prisma.apiAccess.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.systemSetting.deleteMany();
  await prisma.user.deleteMany();
}

async function createUser(opts: {
  name: string;
  email: string;
  password: string;
  role: string;
  access: Partial<Record<(typeof CATEGORIES)[number], boolean>>;
  keyStatus?: string;
}) {
  const user = await prisma.user.create({
    data: {
      name: opts.name,
      email: opts.email.toLowerCase(),
      passwordHash: await bcrypt.hash(opts.password, 10),
      role: opts.role,
      status: "active",
    },
  });
  for (const c of CATEGORIES) {
    await prisma.apiAccess.create({
      data: { userId: user.id, category: c, enabled: !!opts.access[c] },
    });
  }
  const k = genKey();
  await prisma.apiKey.create({
    data: {
      userId: user.id,
      keyHash: k.keyHash,
      keyEncrypted: k.keyEncrypted,
      keyPrefix: k.keyPrefix,
      last4: k.last4,
      status: opts.keyStatus ?? "active",
      lastUsedAt: daysAgo(rand(0, 3)),
    },
  });
  return user;
}

async function main() {
  console.log("Seeding Local AI Gateway (local development data only)...");
  await clearAll();

  // System settings (incl. the runtime defaults used by "Reset to Default")
  const runtimeDefaults = MODELS.map((m) => ({
    modelId: m.modelId,
    startupPolicy: m.policy,
    runtimeType: m.runtime,
    modelSizeClass: m.size,
    enabled: m.enabled,
    maxConcurrent: m.maxConcurrent,
    autoShutdownMinutes: m.autoShutdown,
  }));
  await prisma.systemSetting.createMany({
    data: [
      { key: "maintenance_mode", value: "Off" },
      { key: "maintenance_job_policy", value: "pause" },
      { key: "runtime_defaults", value: JSON.stringify(runtimeDefaults) },
    ],
  });

  // Users
  // Single admin only. Credentials come from .env (SEED_ADMIN_*); no demo users.
  const admin = await createUser({
    name: process.env.SEED_ADMIN_NAME ?? "Manato",
    email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com",
    password: process.env.SEED_ADMIN_PASSWORD ?? "change-me-in-env",
    role: "admin",
    access: { LLM: true, TTS: true, STT: true, Image: true, Vision: true, Video: true, Motion: true },
  });

  // API status
  for (const a of APIS) {
    await prisma.apiStatus.create({
      data: {
        apiName: a.apiName,
        category: a.category,
        status: a.status,
        currentModel: a.model,
        backend: a.backend,
        mode: a.mode,
        usesGpu: a.usesGpu,
        queueCount: a.queue,
        runningCount: a.running,
        averageResponseTime: a.avg,
        errorCount: a.errors,
        description: a.description,
        lastChecked: new Date(),
      },
    });
  }

  // Model registry + runtime config + runtime state
  for (const m of MODELS) {
    await prisma.modelRegistry.create({
      data: {
        modelId: m.modelId,
        category: m.category,
        function: m.function,
        modelName: m.modelName,
        backend: m.backend,
        installed: m.installed,
        estimatedVramMinGb: m.vmin,
        estimatedVramMaxGb: m.vmax,
        defaultDeviceRule: m.rule,
        multiGpuSupported: m.multi,
      },
    });
    await prisma.modelRuntimeConfig.create({
      data: {
        modelId: m.modelId,
        startupPolicy: m.policy,
        runtimeType: m.runtime,
        modelSizeClass: m.size,
        enabled: m.enabled,
        maxConcurrent: m.maxConcurrent,
        autoShutdownMinutes: m.autoShutdown,
      },
    });
    await prisma.modelRuntimeState.create({
      data: {
        modelId: m.modelId,
        currentStatus: m.state,
        devicePlan: devicePlan(m),
        actualDevice: m.state === "Running" ? (m.rule === "CPU" ? "CPU" : "GPU0") : null,
        predictedVramGb: m.vmax,
        currentVramMb: m.state === "Running" ? Math.round(m.vmax * 1024) : 0,
        lastUsedAt: m.state === "Running" ? daysAgo(0) : daysAgo(rand(1, 10)),
        lastError: m.state === "Error" ? "Backend service did not respond on startup." : null,
      },
    });
  }

  // NOTE: no demo usage logs or demo jobs are seeded. Usage logs accumulate from
  // real /v1 calls; jobs are created by real requests and processed by the worker.

  // One VRAM forecast snapshot (default enabled set is comfortably Safe).
  await prisma.vramForecastSnapshot.create({
    data: {
      gpu0PredictedGb: 16,
      gpu1PredictedGb: 13,
      totalPredictedGb: 29,
      status: "Safe",
      reason: "Default always-running + on-demand set fits within each 24GB GPU.",
    },
  });

  // No demo audit entries: the audit log fills from real admin actions.

  console.log("Seed complete.");
  console.log(`  admin -> ${admin.email}`);
  console.log("API key was generated and stored encrypted. Reveal it in the app UI.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
