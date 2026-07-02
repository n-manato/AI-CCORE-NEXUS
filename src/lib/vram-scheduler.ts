import "server-only";

import { prisma } from "@/lib/db";
import { computeDevicePlan } from "@/lib/runtime";
import { estimatedPeakVram, forecastVram, type ForecastModel } from "@/lib/vram";
import { getGpuReport } from "@/lib/gpu";
import { OLLAMA_MAP, ollamaRunning, ollamaSetLoaded } from "@/lib/ollama";
import { SIDECAR_MODELS, sidecarHealth, sidecarUnload } from "@/lib/sidecar";
import { MOTION_MODELS, motionHealth } from "@/lib/motion";
import { isMotionProcessAlive, startMotionService, stopMotionService } from "@/lib/motion-process";
import { GPU_USABLE_VRAM_GB, GPU_VRAM_RESERVE_GB } from "@/lib/constants";

const WAIT_TIMEOUT_MS = Number(process.env.VRAM_WAIT_TIMEOUT_MS ?? 120_000);
const POLL_MS = 400;
// Leave driver/display/KV-growth headroom on each 24GB card.
const MAX_SCHEDULED_GPU_GB = Number(process.env.VRAM_SCHEDULER_LIMIT_GB ?? GPU_USABLE_VRAM_GB);

interface SchedulerState {
  active: Map<string, number>;
  resident: Set<string>;
  initialized: boolean;
  lock: Promise<void>;
}

const globalScheduler = globalThis as unknown as { __vramScheduler?: SchedulerState };
const state = (globalScheduler.__vramScheduler ??= {
  active: new Map(),
  resident: new Set(),
  initialized: false,
  lock: Promise.resolve(),
});

export type VramLeaseResult =
  | { ok: true; release: () => void }
  | { ok: false; reason: string };

async function serialized<T>(work: () => Promise<T>): Promise<T> {
  const previous = state.lock;
  let unlock!: () => void;
  state.lock = new Promise<void>((resolve) => { unlock = resolve; });
  await previous;
  try {
    return await work();
  } finally {
    unlock();
  }
}

function activeCount(modelId: string): number {
  return state.active.get(modelId) ?? 0;
}

function beginLease(modelId: string): () => void {
  state.active.set(modelId, activeCount(modelId) + 1);
  let released = false;
  let safetyTimer: ReturnType<typeof setTimeout>;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(safetyTimer);
    const next = Math.max(0, activeCount(modelId) - 1);
    if (next === 0) state.active.delete(modelId);
    else state.active.set(modelId, next);
    void prisma.modelRuntimeState.update({
      where: { modelId },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});
  };
  safetyTimer = setTimeout(release, 15 * 60_000);
  return release;
}

async function actualResidentModelIds(): Promise<Set<string>> {
  if (!state.initialized) {
    const [ollama, sidecar] = await Promise.all([ollamaRunning(1000), sidecarHealth(1000)]);
    for (const [id, tag] of Object.entries(OLLAMA_MAP)) if (ollama.has(tag)) state.resident.add(id);
    for (const [id, cap] of Object.entries(SIDECAR_MODELS)) if (sidecar?.loaded[cap]) state.resident.add(id);
    if (isMotionProcessAlive()) for (const id of Object.keys(MOTION_MODELS)) state.resident.add(id);
    state.initialized = true;
  }
  const ids = new Set<string>([...state.resident, ...state.active.keys()]);
  return ids;
}

type RegistryRow = Awaited<ReturnType<typeof schedulerRows>>[number];

async function schedulerRows() {
  return prisma.modelRegistry.findMany({ include: { runtimeConfig: true, runtimeState: true } });
}

function toForecast(m: RegistryRow): ForecastModel {
  const policy = m.runtimeConfig?.startupPolicy === "Job Queue"
    ? "On Demand"
    : m.runtimeConfig?.startupPolicy ?? "On Demand";
  return {
    modelId: m.modelId,
    modelName: m.modelName,
    category: m.category,
    backend: m.backend,
    enabled: m.runtimeConfig?.enabled ?? false,
    startupPolicy: policy as ForecastModel["startupPolicy"],
    devicePlan: computeDevicePlan(m).plan,
    estVramMinGb: m.estimatedVramMinGb,
    estVramMaxGb: m.estimatedVramMaxGb,
    maxConcurrent: m.runtimeConfig?.maxConcurrent ?? 1,
    multiGpuSupported: m.multiGpuSupported,
    separateProcessPerRequest: m.separateProcessPerRequest,
  };
}

function fits(rows: RegistryRow[], resident: Set<string>, target: RegistryRow): boolean {
  const forecast = forecastVram(
    rows.filter((m) => resident.has(m.modelId)).map(toForecast),
    { includeAllOnDemand: true },
  );
  const plannedFits = forecast.canApply &&
    forecast.gpu0Gb <= MAX_SCHEDULED_GPU_GB &&
    forecast.gpu1Gb <= MAX_SCHEDULED_GPU_GB;
  if (!plannedFits) return false;

  // On real hardware, also honor non-model VRAM consumers visible to nvidia-smi.
  // Mock telemetry is intentionally ignored so local development is deterministic.
  const report = getGpuReport();
  const plan = computeDevicePlan(target).plan;
  if (report.source !== "nvidia-smi" || plan === "CPU") return true;
  const need = estimatedPeakVram(toForecast(target));
  const usable = report.gpus.map((g) =>
    Math.min(MAX_SCHEDULED_GPU_GB, g.memTotalMb / 1024 - GPU_VRAM_RESERVE_GB),
  );
  const used = report.gpus.map((g) => g.memUsedMb / 1024);
  if (plan === "2GPU") {
    return used.length >= 2 && used[0]! + need / 2 <= usable[0]! && used[1]! + need / 2 <= usable[1]!;
  }
  return used.some((gb, i) => gb + need <= (usable[i] ?? 0));
}

async function unloadModel(m: RegistryRow): Promise<void> {
  const tag = OLLAMA_MAP[m.modelId];
  const cap = SIDECAR_MODELS[m.modelId];
  if (tag) await ollamaSetLoaded(tag, false);
  else if (cap) await sidecarUnload(cap);
  else if (m.modelId in MOTION_MODELS) stopMotionService();
  else throw new Error(`No unload adapter for ${m.modelId}`);

  await prisma.modelRuntimeState.update({
    where: { modelId: m.modelId },
    data: { currentStatus: "Stopped", actualDevice: null, currentVramMb: 0 },
  }).catch(() => {});
  state.resident.delete(m.modelId);
}

async function loadModel(m: RegistryRow): Promise<void> {
  await prisma.modelRuntimeState.update({
    where: { modelId: m.modelId },
    data: { currentStatus: "Loading", lastError: null },
  }).catch(() => {});
  state.resident.add(m.modelId);

  const tag = OLLAMA_MAP[m.modelId];
  if (tag) await ollamaSetLoaded(tag, true, -1);
  else if (m.modelId in MOTION_MODELS) {
    await startMotionService();
    const deadline = Date.now() + 60_000;
    while (!(await motionHealth(1500))) {
      if (Date.now() >= deadline) throw new Error("motion service did not become ready within 60s");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  // Sidecar models load inside their inference request; capacity is reserved now.

  const plan = computeDevicePlan(m).plan;
  await prisma.modelRuntimeState.update({
    where: { modelId: m.modelId },
    data: {
      currentStatus: "Running",
      actualDevice: plan === "CPU" ? "CPU" : plan === "2GPU" ? "GPU0+GPU1" : "GPU",
      currentVramMb: Math.round(m.estimatedVramMaxGb * 1024),
      lastUsedAt: new Date(),
      lastError: null,
    },
  }).catch(() => {});
}

type Attempt =
  | { kind: "acquired"; release: () => void }
  | { kind: "wait"; reason: string }
  | { kind: "failed"; reason: string };

async function attemptAcquire(modelId: string): Promise<Attempt> {
  const rows = await schedulerRows();
  const target = rows.find((m) => m.modelId === modelId);
  if (!target || !target.installed) return { kind: "failed", reason: "model is not installed" };
  const cfg = target.runtimeConfig;
  if (!cfg?.enabled || cfg.startupPolicy === "Disabled") {
    return { kind: "failed", reason: "model is disabled" };
  }

  const actualResident = await actualResidentModelIds();
  const resident = new Set(actualResident);
  for (const m of rows) {
    if (m.installed && m.runtimeConfig?.enabled && m.runtimeConfig.startupPolicy === "Always Running") {
      resident.add(m.modelId); // reserve pinned capacity even while it is loading
    }
  }
  if (actualResident.has(modelId) || computeDevicePlan(target).plan === "CPU") {
    if (!actualResident.has(modelId)) await loadModel(target);
    return { kind: "acquired", release: beginLease(modelId) };
  }

  resident.add(modelId);
  while (!fits(rows, resident, target)) {
    const candidates = rows
      .filter((m) => {
        const policy = m.runtimeConfig?.startupPolicy === "Job Queue" ? "On Demand" : m.runtimeConfig?.startupPolicy;
        return resident.has(m.modelId) &&
          m.modelId !== modelId &&
          policy === "On Demand" &&
          activeCount(m.modelId) === 0 &&
          (!!OLLAMA_MAP[m.modelId] || !!SIDECAR_MODELS[m.modelId] || m.modelId in MOTION_MODELS);
      })
      .sort((a, b) => (a.runtimeState?.lastUsedAt?.getTime() ?? 0) - (b.runtimeState?.lastUsedAt?.getTime() ?? 0));

    const victim = candidates[0];
    if (!victim) {
      const busy = [...resident].some((id) => id !== modelId && activeCount(id) > 0);
      return busy
        ? { kind: "wait", reason: "waiting for an active model to release VRAM" }
        : { kind: "failed", reason: "not enough VRAM after preserving Always Running models" };
    }
    await unloadModel(victim);
    resident.delete(victim.modelId);
  }

  try {
    await loadModel(target);
  } catch (e) {
    const reason = (e as Error).message;
    await prisma.modelRuntimeState.update({
      where: { modelId },
      data: { currentStatus: "Error", lastError: reason },
    }).catch(() => {});
    return { kind: "failed", reason };
  }
  return { kind: "acquired", release: beginLease(modelId) };
}

// Acquires a model residency lease. On Demand models remain pinned after release;
// they are evicted only when a different model needs their VRAM. Active leases
// and Always Running models are never selected as eviction victims.
export async function acquireVramLease(modelId: string): Promise<VramLeaseResult> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let reason = "waiting for VRAM";
  while (Date.now() < deadline) {
    const attempt = await serialized(() => attemptAcquire(modelId));
    if (attempt.kind === "acquired") return { ok: true, release: attempt.release };
    if (attempt.kind === "failed") return { ok: false, reason: attempt.reason };
    reason = attempt.reason;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return { ok: false, reason: `${reason}; timed out after ${Math.round(WAIT_TIMEOUT_MS / 1000)}s` };
}

export function activeModelLeases(): ReadonlyMap<string, number> {
  return state.active;
}

// Called by the periodic backend synchronizer to correct the in-memory view
// after restarts or out-of-band Ollama/sidecar operations.
export function observeResidentModels(modelIds: Iterable<string>): void {
  state.resident = new Set(modelIds);
  state.initialized = true;
}

export function noteModelResidency(modelId: string, resident: boolean): void {
  if (resident) state.resident.add(modelId);
  else state.resident.delete(modelId);
  state.initialized = true;
}
