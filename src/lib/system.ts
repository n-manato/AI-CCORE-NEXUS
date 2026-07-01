import "server-only";
import { prisma } from "@/lib/db";
import { getGpuReport, overallGpuStatus } from "@/lib/gpu";
import { SETTING_KEYS, type MaintenanceState, type GpuStatusValue } from "@/lib/constants";

export async function getSetting(key: string): Promise<string | null> {
  const s = await prisma.systemSetting.findUnique({ where: { key } });
  return s?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getMaintenanceState(): Promise<MaintenanceState> {
  const v = (await getSetting(SETTING_KEYS.maintenanceMode)) as MaintenanceState | null;
  return v ?? "Off";
}

// Total work in the system: waiting + running jobs across all APIs.
export async function getQueueCount(): Promise<number> {
  return prisma.job.count({ where: { status: { in: ["Waiting", "Running"] } } });
}

export async function getRunningJobsCount(): Promise<number> {
  return prisma.job.count({ where: { status: "Running" } });
}

// Resolves the header context shared by both layouts.
export async function getHeaderContext(): Promise<{
  gpuStatus: GpuStatusValue;
  maintenance: MaintenanceState;
}> {
  const [queue, maintenance] = await Promise.all([getQueueCount(), getMaintenanceState()]);
  const gpuStatus = overallGpuStatus(getGpuReport(), queue);
  return { gpuStatus, maintenance };
}
