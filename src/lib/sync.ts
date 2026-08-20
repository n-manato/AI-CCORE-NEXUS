import "server-only";
import { prisma } from "@/lib/db";
import { ollamaTags, ollamaRunning, OLLAMA_MAP, LLM_APP_IDS, VISION_APP_IDS } from "@/lib/ollama";
import { sidecarHealth, SIDECAR_MODELS } from "@/lib/sidecar";
import { motionHealth, MOTION_MODELS } from "@/lib/motion";
import { gestureHealth, GESTURE_MODELS } from "@/lib/gesture";
import { trellisHealth, TRELLIS_MODELS } from "@/lib/trellis";
import { ttsHealth, TTS_MODEL_ID } from "@/lib/tts";
import { API_MODEL } from "@/lib/constants";

export interface SyncResult {
  ollamaReachable: boolean;
  sidecarReachable: boolean;
  installed: string[]; // app model ids backed by a real, available backend
  running: string[]; // app model ids currently loaded
  onlineApis: string[]; // api names now Online
}

// api_status.apiName -> sidecar capability key
const SIDECAR_API: Record<string, string> = {
  OCR: "ocr",
  "Object Detection": "detect",
  STT: "stt",
  TTS: "tts",
  "Background Removal": "removebg",
};

// api_status.apiName -> motion-service capability key
const MOTION_API: Record<string, string> = {
  "Motion Generation": "motion",
};

// api_status.apiName -> gesture-service capability key
const GESTURE_API: Record<string, string> = {
  "Gesture Generation": "gesture",
};

// api_status.apiName -> trellis-service capability key
const TRELLIS_API: Record<string, string> = {
  "3D Generation": "image_to_3d",
};

// Syncs every label in the app to the REAL state of the backends:
//  - Ollama for LLM Chat / Vision QA (+ their models)
//  - Python sidecar for OCR / detection / STT / TTS / background removal
//  - Everything else has no backend yet -> honestly "Not Installed"
//  - queue/running/error counts come from real jobs + usage logs (no seed fakes)
export async function syncBackends(): Promise<SyncResult> {
  const tags = await ollamaTags();
  const ollamaReachable = tags !== null;
  const haveTags = new Set((tags ?? []).map((t) => t.name));
  // Real model sizes from Ollama (on-disk GB ~= weights VRAM) keep the forecast accurate.
  const tagSizeGb = new Map((tags ?? []).map((t) => [t.name, (t.size ?? 0) / 1e9]));
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const ollamaRunningSet = ollamaReachable ? await ollamaRunning() : new Set<string>();

  const health = await sidecarHealth();
  const sidecarReachable = health !== null;
  const caps = health?.capabilities ?? {};
  const loaded = health?.loaded ?? {};

  const mhealth = await motionHealth();
  const motionCaps = mhealth?.capabilities ?? {};
  const motionLoaded = mhealth?.loaded ?? {};

  const ghealth = await gestureHealth();
  const gestureCaps = ghealth?.capabilities ?? {};
  const gestureLoaded = ghealth?.loaded ?? {};

  const thealth = await trellisHealth();
  const trellisCaps = thealth?.capabilities ?? {};
  const trellisLoaded = thealth?.loaded ?? {};

  // Rem voice stack (voice_service :9881 -> GPT-SoVITS :9880) backing `gpt-sovits`.
  const ttsUp = (await ttsHealth()) !== null;

  const installed: string[] = [];
  const running: string[] = [];

  // --- Ollama-backed models ---
  for (const [appId, tag] of Object.entries(OLLAMA_MAP)) {
    const isInstalled = haveTags.has(tag);
    const isRunning = ollamaRunningSet.has(tag);
    if (isInstalled) installed.push(appId);
    if (isRunning) running.push(appId);
    const sizeGb = tagSizeGb.get(tag);
    await prisma.modelRegistry
      .update({
        where: { modelId: appId },
        data: {
          installed: isInstalled,
          // Calibrate the VRAM estimate to the real model size (+ small KV/context headroom).
          ...(isInstalled && sizeGb ? { estimatedVramMinGb: round1(sizeGb), estimatedVramMaxGb: round1(sizeGb + 1.5) } : {}),
        },
      })
      .catch(() => {});
    await prisma.modelRuntimeState
      .update({
        where: { modelId: appId },
        data: {
          currentStatus: isInstalled ? (isRunning ? "Running" : "Stopped") : "Stopped",
          // Ollama packs a model onto a single GPU when it fits (these 4-bit models do).
          actualDevice: isRunning ? "GPU" : null,
        },
      })
      .catch(() => {});
  }

  // --- Sidecar-backed models ---
  for (const [appId, cap] of Object.entries(SIDECAR_MODELS)) {
    const isInstalled = !!caps[cap];
    const isRunning = !!loaded[cap];
    if (isInstalled) installed.push(appId);
    if (isRunning) running.push(appId);
    await prisma.modelRegistry.update({ where: { modelId: appId }, data: { installed: isInstalled } }).catch(() => {});
    await prisma.modelRuntimeState
      .update({
        where: { modelId: appId },
        data: {
          currentStatus: isInstalled ? (isRunning ? "Running" : "Stopped") : "Stopped",
          actualDevice: isRunning ? "CPU" : null,
        },
      })
      .catch(() => {});
  }

  // --- Motion-service-backed models (HY-Motion) ---
  // `installed` reflects weights-on-disk (registry-managed), NOT whether the
  // motion-service process is up — so the model stays listed & UI-controllable
  // even while its backend is stopped. Only currentStatus tracks the live process.
  for (const appId of Object.keys(MOTION_MODELS)) {
    const isRunning = !!motionLoaded["hy_motion"];
    installed.push(appId);
    if (isRunning) running.push(appId);
    await prisma.modelRuntimeState
      .update({
        where: { modelId: appId },
        data: {
          currentStatus: isRunning ? "Running" : "Stopped",
          actualDevice: isRunning ? "GPU" : null,
        },
      })
      .catch(() => {});
  }

  for (const appId of Object.keys(GESTURE_MODELS)) {
    const isRunning = !!gestureLoaded["gesturelsm"];
    installed.push(appId);
    if (isRunning) running.push(appId);
    await prisma.modelRuntimeState
      .update({ where: { modelId: appId }, data: { currentStatus: isRunning ? "Running" : "Stopped", actualDevice: isRunning ? "GPU0" : null } })
      .catch(() => {});
  }

  // --- TRELLIS.2-service-backed models ---
  for (const appId of Object.keys(TRELLIS_MODELS)) {
    const isRunning = !!trellisLoaded["trellis2"];
    installed.push(appId);
    if (isRunning) running.push(appId);
    await prisma.modelRuntimeState
      .update({ where: { modelId: appId }, data: { currentStatus: isRunning ? "Running" : "Stopped", actualDevice: isRunning ? "GPU" : null } })
      .catch(() => {});
  }

  // --- GPT-SoVITS voice stack backing `gpt-sovits` (TTS) ---
  // installed stays registry-managed so the model is UI-controllable even when the
  // stack is down; currentStatus tracks the live voice_service (:9881) process.
  {
    if (ttsUp) running.push(TTS_MODEL_ID);
    await prisma.modelRuntimeState
      .update({ where: { modelId: TTS_MODEL_ID }, data: { currentStatus: ttsUp ? "Running" : "Stopped", actualDevice: ttsUp ? "GPU1" : null } })
      .catch(() => {});
  }

  // --- Models with no backend at all -> not installed, stopped (honest) ---
  const managed = [...Object.keys(OLLAMA_MAP), ...Object.keys(SIDECAR_MODELS), ...Object.keys(MOTION_MODELS), ...Object.keys(GESTURE_MODELS), ...Object.keys(TRELLIS_MODELS), TTS_MODEL_ID];
  await prisma.modelRuntimeState
    .updateMany({ where: { modelId: { notIn: managed }, currentStatus: { not: "Error" } }, data: { currentStatus: "Stopped", currentVramMb: 0, actualDevice: null } })
    .catch(() => {});

  // --- Real queue/running/error counts ---
  const [jobAgg, errAgg, latAgg] = await Promise.all([
    prisma.job.groupBy({ by: ["apiName", "status"], _count: { _all: true } }),
    prisma.usageLog.groupBy({ by: ["apiName"], _sum: { errorCount: true } }),
    prisma.usageLog.groupBy({ by: ["apiName"], _avg: { latencyMs: true }, where: { latencyMs: { gt: 0 } } }),
  ]);
  const queueOf = (api: string) => jobAgg.filter((j) => j.apiName === api && j.status === "Waiting").reduce((n, j) => n + j._count._all, 0);
  const runningOf = (api: string) => jobAgg.filter((j) => j.apiName === api && j.status === "Running").reduce((n, j) => n + j._count._all, 0);
  const errorsOf = (api: string) => errAgg.find((e) => e.apiName === api)?._sum.errorCount ?? 0;
  const avgMsOf = (api: string) => Math.round(latAgg.find((e) => e.apiName === api)?._avg.latencyMs ?? 0);

  // --- API status from real availability ---
  // Model "Enabled" flags (Model Runtime); default true when no config row.
  const cfgs = await prisma.modelRuntimeConfig.findMany({
    select: { modelId: true, enabled: true, startupPolicy: true },
  });
  const enabledOf = new Map(cfgs.map((c) => [c.modelId, c.enabled && c.startupPolicy !== "Disabled"]));
  const isEnabled = (id: string) => enabledOf.get(id) !== false;

  // LLM Chat / Vision QA serve MANY models, so the API is Online when ANY
  // installed model is enabled (the specific requested model is checked
  // per-request at the gateway). This decouples the API from one hardcoded model
  // so disabling, say, qwen3-8b no longer takes the whole Chat API offline.
  const anyLlmInstalled = LLM_APP_IDS.some((id) => installed.includes(id));
  const anyVisionInstalled = VISION_APP_IDS.some((id) => installed.includes(id));
  const llmOnline = LLM_APP_IDS.find((id) => installed.includes(id) && isEnabled(id)) ?? null;
  const visionOnline = VISION_APP_IDS.find((id) => installed.includes(id) && isEnabled(id)) ?? null;
  const onlineApis: string[] = [];

  const apis = await prisma.apiStatus.findMany();
  for (const api of apis) {
    let status = "Not Installed";
    let currentModel = api.currentModel;
    let backend = api.backend;

    if (api.apiName === "LLM Chat") {
      status = llmOnline ? "Online" : anyLlmInstalled ? "Disabled" : "Offline";
      if (llmOnline) { currentModel = llmOnline; backend = "Ollama"; }
    } else if (api.apiName === "Vision QA") {
      status = visionOnline ? "Online" : anyVisionInstalled ? "Disabled" : "Offline";
      if (visionOnline) { currentModel = visionOnline; backend = "Ollama"; }
    } else if (api.apiName === "TTS") {
      // Real TTS is the GPT-SoVITS voice stack (:9881); the Kokoro sidecar is a
      // fallback. An enabled On Demand stack is available even while stopped:
      // gateRequest acquires its lease and starts it before forwarding the call.
      status = ttsUp || caps.tts || isEnabled(TTS_MODEL_ID) ? "Online" : "Offline";
      if (ttsUp) backend = "GPT-SoVITS";
      else if (caps.tts) backend = "Sidecar";
    } else if (api.apiName in SIDECAR_API) {
      const cap = SIDECAR_API[api.apiName];
      status = caps[cap] ? "Online" : "Not Installed";
      if (caps[cap]) backend = "Sidecar";
    } else if (api.apiName in MOTION_API) {
      const cap = MOTION_API[api.apiName];
      // Installed on disk; Online when the backend is up, else Offline (NOT
      // "Not Installed" — that would drop it from /v1/models and the UI actions).
      status = motionCaps[cap] ? "Online" : "Offline";
      if (motionCaps[cap]) backend = "HY-Motion";
    } else if (api.apiName in GESTURE_API) {
      const cap = GESTURE_API[api.apiName];
      // A stopped, enabled On Demand process is ready to be started by the
      // scheduler; do not report it as a degraded backend.
      status = gestureCaps[cap] || isEnabled("gesturelsm-1") ? "Online" : "Offline";
      if (gestureCaps[cap]) backend = "GestureLSM";
    } else if (api.apiName in TRELLIS_API) {
      const cap = TRELLIS_API[api.apiName];
      // Installed on disk. A stopped, enabled On Demand process is still
      // serviceable and must not make the server dashboard Degraded.
      status = trellisCaps[cap] || isEnabled("trellis-2") ? "Online" : "Offline";
      if (trellisCaps[cap]) backend = "TRELLIS";
    } else {
      status = "Not Installed"; // no backend wired yet
    }

    // For single-model APIs (sidecar OCR/TTS/STT/Detection), a disabled
    // governing model takes the API offline. LLM Chat / Vision QA are
    // multi-model and already resolved above, so skip them here.
    const gm = API_MODEL[api.apiName];
    if (gm && api.apiName !== "LLM Chat" && api.apiName !== "Vision QA" && enabledOf.get(gm) === false) {
      status = "Disabled";
    }
    if (api.adminDisabled) status = "Disabled";
    if (status === "Online") onlineApis.push(api.apiName);

    await prisma.apiStatus
      .update({
        where: { apiName: api.apiName },
        data: {
          status,
          currentModel,
          backend,
          queueCount: queueOf(api.apiName),
          runningCount: runningOf(api.apiName),
          errorCount: errorsOf(api.apiName),
          averageResponseTime: avgMsOf(api.apiName), // measured from usage logs
          lastChecked: new Date(),
        },
      })
      .catch(() => {});
  }

  return { ollamaReachable, sidecarReachable, installed, running, onlineApis };
}
