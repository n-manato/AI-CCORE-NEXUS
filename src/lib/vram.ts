import {
  GPU_VRAM_GB,
  GPU_USABLE_VRAM_GB,
  TOTAL_VRAM_GB,
  VRAM_CAUTION,
  VRAM_WARNING,
  VRAM_CRITICAL,
  type DevicePlan,
  type StartupPolicy,
  type VramStatus,
} from "@/lib/constants";

// A model as far as VRAM planning is concerned.
export interface ForecastModel {
  modelId: string;
  modelName: string;
  category: string;
  backend: string;
  enabled: boolean;
  startupPolicy: StartupPolicy;
  devicePlan: DevicePlan;
  estVramMinGb: number;
  estVramMaxGb: number;
  maxConcurrent: number;
  multiGpuSupported: boolean;
  separateProcessPerRequest: boolean;
}

export interface Contributor {
  modelId: string;
  modelName: string;
  device: "GPU0" | "GPU1" | "GPU0+GPU1" | "CPU";
  vramGb: number;
}

export interface ForecastResult {
  gpu0Gb: number;
  gpu1Gb: number;
  totalGb: number;
  gpu0Pct: number; // 0-100, relative to a single 24GB GPU
  gpu1Pct: number;
  totalPct: number; // 0-100, relative to 48GB
  status: VramStatus;
  reason: string;
  canApply: boolean; // false when Over Limit / Invalid Combination
  needsConfirm: boolean; // true when Critical
  contributors: Contributor[];
}

export function estimatedPeakVram(m: ForecastModel): number {
  const base = m.estVramMaxGb;
  const extraRequests = Math.max(0, m.maxConcurrent - 1);
  if (m.separateProcessPerRequest) {
    return base * Math.max(1, m.maxConcurrent);
  }
  // Conservative per-request allowance for KV cache and temporary workspaces.
  const perRequestWorkspace = Math.max(0.5, base * 0.08);
  return base + extraRequests * perRequestWorkspace;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Computes predicted per-GPU and total VRAM. Configuration planning includes
// all pinned models plus the largest switchable On Demand model; the scheduler
// can opt into including every model that is actually resident.
//
// IMPORTANT: the two RTX 3090s are treated as two independent 24GB devices, not
// one 48GB pool. A single-GPU model never spans both cards; only an explicit
// 2GPU model with multi-GPU backend support is split across both.
export function forecastVram(
  models: ForecastModel[],
  options: { includeAllOnDemand?: boolean } = {},
): ForecastResult {
  const eligible = models.filter(
    (m) =>
      m.enabled &&
      m.startupPolicy !== "Disabled" &&
      m.devicePlan !== "Disabled" &&
      m.devicePlan !== "Not Installed",
  );
  const pinned = eligible.filter((m) => m.startupPolicy === "Always Running");
  const onDemand = eligible.filter((m) => m.startupPolicy === "On Demand");
  // Configuration planning reserves every pinned model plus the single largest
  // On Demand model. On Demand residents are pressure-evicted, so summing every
  // enabled model would incorrectly reject valid switchable configurations.
  const dynamic = options.includeAllOnDemand
    ? onDemand
    : [...onDemand].sort((a, b) => estimatedPeakVram(b) - estimatedPeakVram(a)).slice(0, 1);
  const active = [...pinned, ...dynamic];

  let gpu0 = 0;
  let gpu1 = 0;
  let invalid = false;
  let invalidReason = "";
  const contributors: Contributor[] = [];

  // Place 2GPU models first (they constrain both cards), then bin-pack 1GPU
  // models onto whichever card currently has more free space.
  const twoGpu = active.filter((m) => m.devicePlan === "2GPU");
  const oneGpu = active.filter((m) => m.devicePlan === "1GPU");
  const cpu = active.filter((m) => m.devicePlan === "CPU");

  for (const m of twoGpu) {
    const fp = estimatedPeakVram(m);
    if (!m.multiGpuSupported) {
      invalid = true;
      invalidReason = `${m.modelName} requires 2 GPUs but its backend does not support multi-GPU.`;
    }
    // Split evenly across both cards.
    gpu0 += fp / 2;
    gpu1 += fp / 2;
    contributors.push({
      modelId: m.modelId,
      modelName: m.modelName,
      device: "GPU0+GPU1",
      vramGb: round1(fp),
    });
  }

  for (const m of oneGpu) {
    const fp = estimatedPeakVram(m);
    if (gpu0 <= gpu1) {
      gpu0 += fp;
      contributors.push({ modelId: m.modelId, modelName: m.modelName, device: "GPU0", vramGb: round1(fp) });
    } else {
      gpu1 += fp;
      contributors.push({ modelId: m.modelId, modelName: m.modelName, device: "GPU1", vramGb: round1(fp) });
    }
  }

  for (const m of cpu) {
    contributors.push({ modelId: m.modelId, modelName: m.modelName, device: "CPU", vramGb: 0 });
  }

  gpu0 = round1(gpu0);
  gpu1 = round1(gpu1);
  const total = round1(gpu0 + gpu1);

  const gpu0Pct = Math.round((gpu0 / GPU_VRAM_GB) * 100);
  const gpu1Pct = Math.round((gpu1 / GPU_VRAM_GB) * 100);
  const totalPct = Math.round((total / TOTAL_VRAM_GB) * 100);

  // Decide status. Per-GPU limits dominate: if either card exceeds 24GB the
  // result is Over Limit even when the 48GB total looks fine.
  const worstFrac = Math.max(gpu0, gpu1) / GPU_USABLE_VRAM_GB;
  let status: VramStatus;
  let canApply = true;
  let needsConfirm = false;

  if (invalid) {
    status = "Invalid Combination";
    canApply = false;
  } else if (gpu0 > GPU_USABLE_VRAM_GB || gpu1 > GPU_USABLE_VRAM_GB) {
    status = "Over Limit";
    canApply = false;
  } else if (worstFrac >= VRAM_CRITICAL) {
    status = "Critical";
    needsConfirm = true;
  } else if (worstFrac >= VRAM_WARNING) {
    status = "Warning";
  } else if (worstFrac >= VRAM_CAUTION) {
    status = "Caution";
  } else {
    status = "Safe";
  }

  const reason = buildReason(status, gpu0, gpu1, contributors, invalidReason);

  return {
    gpu0Gb: gpu0,
    gpu1Gb: gpu1,
    totalGb: total,
    gpu0Pct,
    gpu1Pct,
    totalPct,
    status,
    reason,
    canApply,
    needsConfirm,
    contributors,
  };
}

function buildReason(
  status: VramStatus,
  gpu0: number,
  gpu1: number,
  contributors: Contributor[],
  invalidReason: string,
): string {
  if (status === "Invalid Combination") return invalidReason;

  const top = [...contributors]
    .filter((c) => c.vramGb > 0)
    .sort((a, b) => b.vramGb - a.vramGb)
    .slice(0, 3)
    .map((c) => `${c.modelName} (${c.vramGb}GB on ${c.device})`);

  const heavyGpu = gpu0 >= gpu1
    ? `GPU 0 at ${gpu0}/${GPU_USABLE_VRAM_GB}GB usable`
    : `GPU 1 at ${gpu1}/${GPU_USABLE_VRAM_GB}GB usable`;

  switch (status) {
    case "Over Limit":
      return `${gpu0 > GPU_USABLE_VRAM_GB ? "GPU 0" : "GPU 1"} is predicted to exceed the ${GPU_USABLE_VRAM_GB}GB safe limit (${GPU_VRAM_GB}GB physical). Top consumers: ${top.join(", ") || "none"}.`;
    case "Critical":
      return `${heavyGpu}. Top consumers: ${top.join(", ") || "none"}.`;
    case "Warning":
      return `${heavyGpu}. Consider reducing heavy-job concurrency. Top consumers: ${top.join(", ") || "none"}.`;
    case "Caution":
      return `${heavyGpu}. Headroom is limited. Top consumers: ${top.join(", ") || "none"}.`;
    default:
      return `Plenty of headroom. ${heavyGpu}. Top consumers: ${top.join(", ") || "none"}.`;
  }
}
