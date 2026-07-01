import "server-only";
import os from "os";
import { execFileSync } from "child_process";

export interface SystemMetrics {
  cpuPct: number; // 0-100
  ramUsedGb: number;
  ramTotalGb: number;
  ramPct: number;
  diskUsedGb: number;
  diskTotalGb: number;
  diskPct: number;
  uptimeHours: number;
  source: "host" | "mock";
}

let lastCpu: { idle: number; total: number } | null = null;

// CPU utilization from two os.cpus() snapshots (delta since the previous call).
function cpuPercent(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  if (!lastCpu) {
    lastCpu = { idle, total };
    // First sample: approximate from load average.
    const load = os.loadavg()[0] / Math.max(1, cpus.length);
    return Math.min(100, Math.round(load * 100));
  }
  const idleDelta = idle - lastCpu.idle;
  const totalDelta = total - lastCpu.total;
  lastCpu = { idle, total };
  if (totalDelta <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((1 - idleDelta / totalDelta) * 100)));
}

function diskUsage(): { usedGb: number; totalGb: number } | null {
  try {
    const out = execFileSync("df", ["-kP", "/"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const line = out.trim().split("\n").at(-1) ?? "";
    const cols = line.split(/\s+/);
    const totalKb = Number(cols[1]);
    const usedKb = Number(cols[2]);
    if (!Number.isFinite(totalKb) || totalKb <= 0) return null;
    return { usedGb: usedKb / 1024 / 1024, totalGb: totalKb / 1024 / 1024 };
  } catch {
    return null;
  }
}

// Reads real host metrics where cheap (RAM, CPU, disk) and falls back to mock
// values for anything unavailable. The dashboard treats this as one adapter so
// real per-process GPU job metrics can be added later.
export function getSystemMetrics(): SystemMetrics {
  const ramTotal = os.totalmem();
  const ramFree = os.freemem();
  const ramUsed = ramTotal - ramFree;
  const disk = diskUsage();

  const ramTotalGb = ramTotal / 1024 ** 3;
  const ramUsedGb = ramUsed / 1024 ** 3;

  const diskTotalGb = disk ? disk.totalGb : 2048;
  const diskUsedGb = disk ? disk.usedGb : 2048 * 0.41;

  return {
    cpuPct: cpuPercent(),
    ramUsedGb: round1(ramUsedGb),
    ramTotalGb: round1(ramTotalGb),
    ramPct: Math.round((ramUsedGb / ramTotalGb) * 100),
    diskUsedGb: round1(diskUsedGb),
    diskTotalGb: round1(diskTotalGb),
    diskPct: Math.round((diskUsedGb / diskTotalGb) * 100),
    uptimeHours: round1(os.uptime() / 3600),
    source: disk ? "host" : "mock",
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
