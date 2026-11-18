import "server-only";
import { prisma } from "@/lib/db";
import { syncBackends } from "@/lib/sync";
import { OLLAMA_MAP, ollamaSetLoaded, ollamaRunning } from "@/lib/ollama";
import { startMotionService, stopMotionService, isMotionProcessAlive } from "@/lib/motion-process";
import { startGestureService, stopGestureService, isGestureProcessAlive } from "@/lib/gesture-process";
import { startTrellisService, stopTrellisService, isTrellisProcessAlive } from "@/lib/trellis-process";
import { startGenesisService, stopGenesisService, isGenesisProcessAlive } from "@/lib/genesis-process";
import { startTtsService, stopTtsService, isTtsProcessAlive } from "@/lib/tts-process";
import { trellisHealth } from "@/lib/trellis";
import { noteModelResidency, observeResidentModels } from "@/lib/vram-scheduler";

// Server-side background loop. Started once from instrumentation.ts. Every tick it:
//  1) syncs labels to the live backends (so API status / model Running stay fresh
//     without anyone pressing "Sync"),
//  2) processes the job queue (real state transitions; no stuck jobs),
//  3) applies retention.

const g = globalThis as unknown as { __lagWorker?: boolean; __lagTicking?: boolean };

// Real job handlers keyed by apiName. Empty until a heavy job backend (e.g.
// ComfyUI image generation) is wired in; a job for an API with no handler fails
// fast with a clear reason instead of sticking in the queue forever.
const JOB_HANDLERS: Record<string, (jobId: string) => Promise<{ resultPath?: string }>> = {};

const TICK_MS = 15_000;

export function startBackgroundWorker(): void {
  if (g.__lagWorker) return;
  g.__lagWorker = true;
  setTimeout(tick, 3_000); // shortly after boot
  setInterval(tick, TICK_MS);
}

async function tick(): Promise<void> {
  if (g.__lagTicking) return;
  g.__lagTicking = true;
  try {
    await syncBackends().then((result) => observeResidentModels(result.running)).catch(() => {});
    await reconcileModels().catch(() => {});
    await processJobs().catch(() => {});
    await retention().catch(() => {});
  } finally {
    g.__lagTicking = false;
  }
}

// Makes the real Ollama load state match the runtime config:
//  - enabled + Always Running  -> pinned in VRAM (keep_alive -1)
//  - disabled (and loaded)     -> unloaded to free VRAM
//  - everything else           -> left to load lazily on demand
// Exported so Apply can enact the config immediately (no need to wait a tick or
// press a manual Load button). Sidecar models load lazily and are left alone.
export async function reconcileModels(): Promise<void> {
  // Migrate legacy configs in place. Job processing remains available as an API
  // mode, but it is no longer a model residency policy.
  await prisma.modelRuntimeConfig.updateMany({
    where: { startupPolicy: "Job Queue" },
    data: { startupPolicy: "On Demand", autoShutdownMinutes: 0 },
  }).catch(() => {});
  const running = await ollamaRunning();
  const models = await prisma.modelRegistry.findMany({
    where: { installed: true },
    include: { runtimeConfig: true },
  });
  for (const m of models) {
    const tag = OLLAMA_MAP[m.modelId];
    if (!tag) continue;
    const cfg = m.runtimeConfig;
    if (cfg?.enabled && cfg.startupPolicy === "Always Running") {
      await ollamaSetLoaded(tag, true, -1)
        .then(() => noteModelResidency(m.modelId, true))
        .catch(() => {}); // load + pin
    } else if ((!cfg?.enabled || cfg.startupPolicy === "Disabled") && running.has(tag)) {
      await ollamaSetLoaded(tag, false)
        .then(() => noteModelResidency(m.modelId, false))
        .catch(() => {}); // unload (free VRAM)
    }
  }

  // HY-Motion: the model IS a separate process, so the enable toggle starts/stops
  // the whole motion-service process - the analog of Ollama load/unload.
  const motion = models.find((m) => m.modelId === "hy-motion-1");
  if (motion?.runtimeConfig) {
    const wantUp = motion.runtimeConfig.enabled && motion.runtimeConfig.startupPolicy === "Always Running";
    const isUp = isMotionProcessAlive();
    if (wantUp && !isUp) {
      await startMotionService();
    } else if ((!motion.runtimeConfig.enabled || motion.runtimeConfig.startupPolicy === "Disabled") && isUp) {
      stopMotionService();
      noteModelResidency(motion.modelId, false);
    }
  }

  // GestureLSM: same as HY-Motion — a separate process the enable toggle starts/stops.
  const gesture = models.find((m) => m.modelId === "gesturelsm-1");
  if (gesture?.runtimeConfig) {
    const wantUp = gesture.runtimeConfig.enabled && gesture.runtimeConfig.startupPolicy === "Always Running";
    const isUp = isGestureProcessAlive();
    if (wantUp && !isUp) {
      await startGestureService();
    } else if ((!gesture.runtimeConfig.enabled || gesture.runtimeConfig.startupPolicy === "Disabled") && isUp) {
      stopGestureService();
      noteModelResidency(gesture.modelId, false);
    }
  }

  // With the cron keepalive removed, GPT-SoVITS is fully gateway-managed and can
  // follow the same lifecycle contract as the other dedicated GPU backends.
  const tts = models.find((m) => m.modelId === "gpt-sovits");
  if (tts?.runtimeConfig) {
    const wantUp = tts.runtimeConfig.enabled && tts.runtimeConfig.startupPolicy === "Always Running";
    const isUp = isTtsProcessAlive();
    if (wantUp && !isUp) {
      await startTtsService();
    } else if ((!tts.runtimeConfig.enabled || tts.runtimeConfig.startupPolicy === "Disabled") && isUp) {
      stopTtsService();
      noteModelResidency(tts.modelId, false);
    }
  }

  // TRELLIS.2: a separate process whose startup policy selects its VRAM behaviour.
  //  - Always Running -> pinned resident in VRAM (started here with pin=true).
  //  - On Demand      -> offloaded (near-zero idle VRAM); the VRAM scheduler starts
  //                      it lazily on the first request with pin=false.
  //  - Disabled       -> stopped.
  // Switching policy re-spawns the service in the matching mode. We only act on a
  // FULLY LOADED service (health.loaded) so we never kill an in-progress load.
  const trellis = models.find((m) => m.modelId === "trellis-2");
  if (trellis?.runtimeConfig) {
    const cfg = trellis.runtimeConfig;
    const isUp = isTrellisProcessAlive();
    if (!cfg.enabled || cfg.startupPolicy === "Disabled") {
      if (isUp) {
        stopTrellisService();
        noteModelResidency(trellis.modelId, false);
      }
    } else if (cfg.startupPolicy === "Always Running") {
      if (!isUp) {
        await startTrellisService(true); // pin resident in VRAM
      } else {
        const h = await trellisHealth(1500);
        // Loaded but NOT pinned (e.g. was On Demand) -> drop; next tick re-spawns pinned.
        if (h?.loaded?.trellis2 === true && h.pinned === false) {
          stopTrellisService();
          noteModelResidency(trellis.modelId, false);
        }
      }
    } else if (isUp) {
      // On Demand + enabled: if it is loaded and still pinned (left over from
      // Always Running), drop it so the scheduler re-loads it offloaded on next use.
      const h = await trellisHealth(1500);
      if (h?.loaded?.trellis2 === true && h.pinned === true) {
        stopTrellisService();
        noteModelResidency(trellis.modelId, false);
      }
    }
  }

  // Genesis3D: a separate process the enable toggle starts/stops, like HY-Motion.
  // It has no pinned/offloaded distinction (it holds no weights itself — the heavy
  // models run as short-lived subprocesses), so Always Running simply means "up".
  const genesis = models.find((m) => m.modelId === "genesis3d");
  if (genesis?.runtimeConfig) {
    const cfg = genesis.runtimeConfig;
    const isUp = isGenesisProcessAlive();
    if (!cfg.enabled || cfg.startupPolicy === "Disabled") {
      if (isUp) {
        stopGenesisService();
        noteModelResidency(genesis.modelId, false);
      }
    } else if (cfg.startupPolicy === "Always Running" && !isUp) {
      await startGenesisService();
    }
  }
}

async function processJobs(): Promise<void> {
  const waiting = await prisma.job.findMany({
    where: { status: "Waiting" },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: 3,
  });

  for (const job of waiting) {
    await prisma.job.update({ where: { id: job.id }, data: { status: "Running", startedAt: new Date(), progress: 5 } });
    const handler = JOB_HANDLERS[job.apiName];
    if (!handler) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "Failed",
          completedAt: new Date(),
          errorMessage: `No backend is installed for ${job.apiName}. Connect a real backend to enable this job.`,
        },
      });
      continue;
    }
    try {
      const r = await handler(job.id);
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "Completed", progress: 100, completedAt: new Date(), resultPath: r.resultPath ?? null },
      });
    } catch (e) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "Failed", completedAt: new Date(), errorMessage: (e as Error).message },
      });
    }
  }

  // Crash recovery: fail jobs stuck Running for more than 10 minutes.
  await prisma.job.updateMany({
    where: { status: "Running", startedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    data: { status: "Failed", completedAt: new Date(), errorMessage: "Job exceeded the maximum run time." },
  });
}

// Retention per spec: completed results 7 days, failed/canceled 14 days.
async function retention(): Promise<void> {
  const now = Date.now();
  await prisma.job.deleteMany({ where: { status: "Completed", completedAt: { lt: new Date(now - 7 * 86_400_000) } } });
  await prisma.job.deleteMany({
    where: { status: { in: ["Failed", "Canceled"] }, completedAt: { lt: new Date(now - 14 * 86_400_000) } },
  });
}
