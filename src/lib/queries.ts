import "server-only";
import { prisma } from "@/lib/db";
import { getGpuReport, deriveGpuStatus, overallGpuStatus } from "@/lib/gpu";
import { getSystemMetrics } from "@/lib/metrics";
import { getQueueCount } from "@/lib/system";
import { decideAccess } from "@/lib/access";
import { GPU_VRAM_GB, CATEGORIES, SETTING_KEYS, type Category, type Access, type ApiStatusValue } from "@/lib/constants";
import type { GpuCardData } from "@/components/dashboard/gpu-status-card";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ---- Dashboard ----

export async function getDashboardData() {
  const queue = await getQueueCount();
  const report = getGpuReport();
  const metrics = getSystemMetrics();

  const gpuCards: GpuCardData[] = report.gpus.map((g) => ({
    index: g.index,
    name: g.name,
    memUsedGb: g.memUsedMb / 1024,
    memTotalGb: g.memTotalMb / 1024,
    memUsedPct: g.memUsedPct,
    utilizationPct: g.utilizationPct,
    temperatureC: g.temperatureC,
    status: deriveGpuStatus(g.memUsedPct, queue),
  }));

  const [jobsByStatus, apis, todayAgg, maintenanceSetting] = await Promise.all([
    prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.apiStatus.findMany(),
    prisma.usageLog.aggregate({
      _sum: { requestCount: true, errorCount: true },
      where: { timestamp: { gte: startOfToday() } },
    }),
    prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.maintenanceMode } }),
  ]);

  const jobCount = (s: string) => jobsByStatus.find((j) => j.status === s)?._count._all ?? 0;
  const queueCounts = {
    waiting: jobCount("Waiting"),
    running: jobCount("Running"),
    completed: jobCount("Completed"),
    failed: jobCount("Failed"),
    canceled: jobCount("Canceled"),
  };

  const runningApis = apis.filter((a) => a.status === "Online").length;
  const offlineApis = apis.filter((a) => a.status === "Offline" || a.status === "Error").length;

  // Real server status: Maintenance if the mode is on, Degraded if any API
  // backend is offline/errored, otherwise Operational.
  const serverStatus = maintenanceSetting?.value === "On"
    ? "Maintenance"
    : offlineApis > 0
      ? "Degraded"
      : "Operational";

  const maxTemp = Math.max(0, ...report.gpus.map((g) => g.temperatureC));
  const avgVramPct =
    report.gpus.length > 0
      ? Math.round(report.gpus.reduce((n, g) => n + g.memUsedPct, 0) / report.gpus.length)
      : 0;

  return {
    metrics,
    gpuCards,
    gpuSource: report.source,
    overallGpu: overallGpuStatus(report, queue),
    queueCounts,
    queue,
    runningJobs: queueCounts.running,
    serverStatus,
    runningApis,
    offlineApis,
    totalApis: apis.length,
    requestsToday: todayAgg._sum.requestCount ?? 0,
    errorsToday: todayAgg._sum.errorCount ?? 0,
    maxTemp,
    avgVramPct,
    totalVramGb: GPU_VRAM_GB * report.gpus.length,
    lastUpdated: new Date().toISOString(),
  };
}

// ---- APIs overview (system-wide, not per-user) ----

export async function getApisOverview() {
  const queue = await getQueueCount();
  const report = getGpuReport();
  const gpuStatus = overallGpuStatus(report, queue);
  const apis = await prisma.apiStatus.findMany({ orderBy: [{ category: "asc" }, { apiName: "asc" }] });
  return { apis, gpuStatus };
}

// ---- My Access view ----

export interface AccessRow {
  apiName: string;
  category: Category;
  access: Access;
  apiStatus: ApiStatusValue;
  gpuStatus: string;
  result: string;
  currentModel: string | null;
  url: string | null;
  showUrl: boolean;
}

const API_PATH: Record<string, string> = {
  "LLM Chat": "/v1/chat/completions",
  "LLM RAG": "/v1/rag/query",
  TTS: "/v1/audio/speech",
  STT: "/v1/audio/transcriptions",
  "Speech Enhancement": "/v1/audio/enhance",
  "Voice Conversion": "/v1/audio/voice-conversion",
  "Vision QA": "/v1/vision/chat",
  OCR: "/v1/vision/ocr",
  "Object Detection": "/v1/vision/detect",
  Segmentation: "/v1/vision/segment",
  "Pose Estimation": "/v1/vision/pose",
  "Depth Estimation": "/v1/vision/depth",
  "Image Generation": "/v1/images/generations",
  "Image Enhancement": "/v1/images/enhance",
  "Background Removal": "/v1/images/remove-background",
  "Video Understanding": "/v1/video/understanding/jobs",
  "Lip Sync": "/v1/video/lip-sync/jobs",
  "Motion Generation": "/v1/motion/generate",
  "Robot Motion": "/v1/robot-motion/commands",
};

export function endpointPath(apiName: string): string | null {
  return API_PATH[apiName] ?? null;
}

export async function getMyAccessView(userId: string): Promise<AccessRow[]> {
  const queue = await getQueueCount();
  const report = getGpuReport();
  const gpuStatusValue = overallGpuStatus(report, queue);

  const [apis, access] = await Promise.all([
    prisma.apiStatus.findMany({ orderBy: [{ category: "asc" }, { apiName: "asc" }] }),
    prisma.apiAccess.findMany({ where: { userId } }),
  ]);
  const accessMap = new Map(access.map((a) => [a.category, a.enabled]));
  const base = process.env.NEXT_PUBLIC_GATEWAY_BASE_URL ?? "https://ai-gateway.example.edu/v1";

  return apis.map((api) => {
    const enabled = !!accessMap.get(api.category);
    const accessVal: Access = enabled ? "Enabled" : "Disabled";
    const decision = decideAccess({
      access: accessVal,
      apiStatus: api.status as ApiStatusValue,
      gpuStatus: gpuStatusValue,
    });
    const path = endpointPath(api.apiName);
    const url = decision.showUrl && path ? `${base.replace(/\/v1$/, "")}${path}` : null;
    return {
      apiName: api.apiName,
      category: api.category as Category,
      access: accessVal,
      apiStatus: api.status as ApiStatusValue,
      gpuStatus: api.usesGpu ? gpuStatusValue : "Available",
      result: decision.result,
      currentModel: api.currentModel,
      url,
      showUrl: decision.showUrl,
    };
  });
}

// ---- Usage aggregation ----

interface CatCounts {
  LLM: number;
  TTS: number;
  STT: number;
  Image: number;
  Vision: number;
  Video: number;
  Motion: number;
}

function emptyCounts(): CatCounts {
  return { LLM: 0, TTS: 0, STT: 0, Image: 0, Vision: 0, Video: 0, Motion: 0 };
}

export async function getAdminUsage() {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const [users, logs] = await Promise.all([
    prisma.user.findMany({ orderBy: { name: "asc" } }),
    prisma.usageLog.findMany({ where: { timestamp: { gte: since } } }),
  ]);

  const byUser = new Map<string, { counts: CatCounts; errors: number; total: number; last: Date | null }>();
  for (const u of users) byUser.set(u.id, { counts: emptyCounts(), errors: 0, total: 0, last: null });

  const byCategory = emptyCounts();
  const errorsByModel = new Map<string, number>();
  const byDay = new Map<string, { requests: number; errors: number }>();

  // Pre-seed 14 day buckets so the chart is continuous.
  for (let d = 13; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86_400_000);
    byDay.set(dayLabel(day), { requests: 0, errors: 0 });
  }

  // Per-category time series.
  const catByDay = new Map<string, CatCounts>();
  for (let d = 13; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86_400_000);
    catByDay.set(dayLabel(day), emptyCounts());
  }

  for (const log of logs) {
    const rec = byUser.get(log.userId);
    const cat = log.category as keyof CatCounts;
    if (rec && cat in rec.counts) {
      rec.counts[cat] += log.requestCount;
      rec.errors += log.errorCount;
      rec.total += log.requestCount;
      if (!rec.last || log.timestamp > rec.last) rec.last = log.timestamp;
    }
    if (cat in byCategory) byCategory[cat] += log.requestCount;
    if (log.model && log.errorCount > 0) {
      errorsByModel.set(log.model, (errorsByModel.get(log.model) ?? 0) + log.errorCount);
    }
    const dl = dayLabel(log.timestamp);
    const bucket = byDay.get(dl);
    if (bucket) {
      bucket.requests += log.requestCount;
      bucket.errors += log.errorCount;
    }

    const catBucket = catByDay.get(dl);
    if (catBucket && cat in catBucket) catBucket[cat] += log.requestCount;
  }

  const rows = users.map((u) => {
    const rec = byUser.get(u.id)!;
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      ...rec.counts,
      total: rec.total,
      errors: rec.errors,
      lastUsed: rec.last ? rec.last.toISOString() : null,
    };
  });

  return {
    rows,
    overTime: Array.from(byDay.entries()).map(([label, v]) => ({ label, ...v })),
    byUser: rows
      .filter((r) => r.total > 0)
      .map((r) => ({ label: r.name, value: r.total }))
      .sort((a, b) => b.value - a.value),
    byCategory: CATEGORIES.map((c) => ({ name: c, value: byCategory[c] })).filter((d) => d.value > 0),
    errorsByModel: Array.from(errorsByModel.entries())
      .filter(([, v]) => v > 0)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    // Per-category requests per day (stacked area).
    categoryOverTime: Array.from(catByDay.entries()).map(([label, v]) => ({ label, ...v })),
  };
}

export async function getMyUsage(userId: string) {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const logs = await prisma.usageLog.findMany({ where: { userId, timestamp: { gte: since } } });

  const counts = emptyCounts();
  let errors = 0;
  let last: Date | null = null;
  let requestsToday = 0;
  const today = startOfToday();
  const byDay = new Map<string, number>();
  for (let d = 13; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86_400_000);
    byDay.set(dayLabel(day), 0);
  }

  for (const log of logs) {
    const cat = log.category as keyof CatCounts;
    if (cat in counts) counts[cat] += log.requestCount;
    errors += log.errorCount;
    if (!last || log.timestamp > last) last = log.timestamp;
    if (log.timestamp >= today) requestsToday += log.requestCount;
    const dl = dayLabel(log.timestamp);
    if (byDay.has(dl)) byDay.set(dl, (byDay.get(dl) ?? 0) + log.requestCount);
  }

  return {
    counts,
    errors,
    requestsToday,
    lastUsed: last ? last.toISOString() : null,
    overTime: Array.from(byDay.entries()).map(([label, requests]) => ({ label, requests })),
  };
}
