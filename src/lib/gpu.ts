import "server-only";
import { execFileSync } from "child_process";
import {
  GPU_BUSY_VRAM,
  GPU_FULL_VRAM,
  QUEUE_BUSY,
  QUEUE_FULL,
  GPU_VRAM_GB,
  type GpuStatusValue,
} from "@/lib/constants";

export interface GpuInfo {
  index: number;
  name: string;
  memTotalMb: number;
  memUsedMb: number;
  memUsedPct: number; // 0-100
  utilizationPct: number; // 0-100
  temperatureC: number;
}

export interface GpuReport {
  gpus: GpuInfo[];
  source: "nvidia-smi" | "mock";
  detected: boolean;
}

// Adapter that reads real GPU telemetry via nvidia-smi when available, and
// otherwise returns believable mock data for two RTX 3090 cards. Swap the body
// of readNvidiaSmi (or add another reader) to wire in a different metrics source.
export function getGpuReport(): GpuReport {
  const real = readNvidiaSmi();
  if (real && real.length > 0) {
    return { gpus: real, source: "nvidia-smi", detected: true };
  }
  return { gpus: mockGpus(), source: "mock", detected: true };
}

function readNvidiaSmi(): GpuInfo[] | null {
  try {
    const out = execFileSync(
      "nvidia-smi",
      [
        "--query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu",
        "--format=csv,noheader,nounits",
      ],
      { encoding: "utf8", timeout: 2500, stdio: ["ignore", "pipe", "ignore"] },
    );
    const gpus: GpuInfo[] = [];
    for (const line of out.trim().split("\n")) {
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length < 6) continue;
      const [index, name, memTotal, memUsed, util, temp] = parts;
      const memTotalMb = Number(memTotal);
      const memUsedMb = Number(memUsed);
      if (!Number.isFinite(memTotalMb) || memTotalMb <= 0) continue;
      gpus.push({
        index: Number(index),
        name,
        memTotalMb,
        memUsedMb,
        memUsedPct: Math.round((memUsedMb / memTotalMb) * 100),
        utilizationPct: Number(util) || 0,
        temperatureC: Number(temp) || 0,
      });
    }
    return gpus.length ? gpus : null;
  } catch {
    // nvidia-smi missing, driver mismatch, or timeout -> fall back to mock.
    return null;
  }
}

// Deterministic-ish mock for two RTX 3090s with some run-to-run variation.
function mockGpus(): GpuInfo[] {
  const totalMb = GPU_VRAM_GB * 1024;
  const make = (index: number, base: number, util: number, temp: number): GpuInfo => {
    const jitter = (Math.random() - 0.5) * 0.08;
    const pct = Math.min(0.98, Math.max(0.05, base + jitter));
    const memUsedMb = Math.round(totalMb * pct);
    return {
      index,
      name: "NVIDIA GeForce RTX 3090",
      memTotalMb: totalMb,
      memUsedMb,
      memUsedPct: Math.round(pct * 100),
      utilizationPct: Math.min(100, Math.max(0, Math.round(util + (Math.random() - 0.5) * 20))),
      temperatureC: Math.round(temp + (Math.random() - 0.5) * 6),
    };
  };
  return [make(0, 0.52, 64, 68), make(1, 0.38, 41, 61)];
}

// Maps VRAM usage + queue depth onto the GPU status buckets from the spec.
export function deriveGpuStatus(memUsedPct: number, queueCount: number): GpuStatusValue {
  const frac = memUsedPct / 100;
  if (frac >= GPU_FULL_VRAM || queueCount >= QUEUE_FULL) return "Full";
  if (frac >= GPU_BUSY_VRAM || queueCount >= QUEUE_BUSY) return "Busy";
  return "Available";
}

// Combined badge status across both GPUs (worst card wins). Returns Offline when
// no GPU is detected at all.
export function overallGpuStatus(report: GpuReport, queueCount: number): GpuStatusValue {
  if (!report.detected || report.gpus.length === 0) return "Offline";
  const order: GpuStatusValue[] = ["Available", "Busy", "Full"];
  let worst: GpuStatusValue = "Available";
  for (const g of report.gpus) {
    const s = deriveGpuStatus(g.memUsedPct, queueCount);
    if (order.indexOf(s) > order.indexOf(worst)) worst = s;
  }
  return worst;
}
