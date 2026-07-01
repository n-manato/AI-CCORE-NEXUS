import "server-only";
import { prisma } from "@/lib/db";
import { appIdToTag } from "@/lib/ollama";
import { forecastVram, type ForecastModel, type ForecastResult } from "@/lib/vram";
import type { DevicePlan, StartupPolicy } from "@/lib/constants";

// A fully-resolved runtime row used by the Model Runtime table (serializable for
// passing to the client component).
export interface RuntimeRow {
  modelId: string;
  // The exact Ollama tag clients paste as the Cline "Model ID" (e.g.
  // "qwen3-coder-next:IQ4_XS"). null for non-Ollama models (sidecar/vLLM-only).
  ollamaTag: string | null;
  modelName: string;
  category: string;
  function: string;
  backend: string;
  installed: boolean;
  estVramMinGb: number;
  estVramMaxGb: number;
  multiGpuSupported: boolean;
  devicePlan: DevicePlan; // read-only, system-calculated
  devicePlanReason: string;
  currentStatus: string;
  // Editable fields:
  startupPolicy: StartupPolicy;
  runtimeType: string;
  modelSizeClass: string;
  enabled: boolean;
  maxConcurrent: number;
  autoShutdownMinutes: number;
}

// Device Plan is computed from the registry, never edited by the admin.
export function computeDevicePlan(m: {
  installed: boolean;
  defaultDeviceRule: string;
}): { plan: DevicePlan; reason: string } {
  if (!m.installed) {
    return { plan: "Not Installed", reason: "Model is not installed on the server." };
  }
  if (m.defaultDeviceRule === "Disabled") {
    return { plan: "Disabled", reason: "Disabled by default (experimental or admin-only)." };
  }
  switch (m.defaultDeviceRule) {
    case "CPU":
      return { plan: "CPU", reason: "Lightweight model runs on CPU; no GPU VRAM used." };
    case "2GPU":
      return {
        plan: "2GPU",
        reason: "Large model exceeds a single 24GB GPU; spans GPU0 + GPU1 (multi-GPU backend).",
      };
    default:
      return { plan: "1GPU", reason: "Fits within one 24GB GPU." };
  }
}

// Reads all models joined with config + state into RuntimeRow[].
export async function getRuntimeRows(): Promise<RuntimeRow[]> {
  const models = await prisma.modelRegistry.findMany({
    include: { runtimeConfig: true, runtimeState: true },
    orderBy: [{ category: "asc" }, { modelName: "asc" }],
  });

  return models.map((m) => {
    const dp = computeDevicePlan(m);
    return {
      modelId: m.modelId,
      ollamaTag: appIdToTag(m.modelId) ?? null,
      modelName: m.modelName,
      category: m.category,
      function: m.function,
      backend: m.backend,
      installed: m.installed,
      estVramMinGb: m.estimatedVramMinGb,
      estVramMaxGb: m.estimatedVramMaxGb,
      multiGpuSupported: m.multiGpuSupported,
      devicePlan: dp.plan,
      devicePlanReason: dp.reason,
      currentStatus: m.runtimeState?.currentStatus ?? "Stopped",
      startupPolicy: (m.runtimeConfig?.startupPolicy ?? "On Demand") as StartupPolicy,
      runtimeType: m.runtimeConfig?.runtimeType ?? "Sync",
      modelSizeClass: m.runtimeConfig?.modelSizeClass ?? "Medium",
      enabled: m.runtimeConfig?.enabled ?? false,
      maxConcurrent: m.runtimeConfig?.maxConcurrent ?? 1,
      autoShutdownMinutes: m.runtimeConfig?.autoShutdownMinutes ?? 15,
    };
  });
}

// Converts runtime rows into the model list consumed by the VRAM forecaster.
export function rowsToForecastModels(rows: RuntimeRow[]): ForecastModel[] {
  return rows.map((r) => ({
    modelId: r.modelId,
    modelName: r.modelName,
    category: r.category,
    enabled: r.enabled,
    startupPolicy: r.startupPolicy,
    devicePlan: r.devicePlan,
    estVramMinGb: r.estVramMinGb,
    estVramMaxGb: r.estVramMaxGb,
    maxConcurrent: r.maxConcurrent,
    multiGpuSupported: r.multiGpuSupported,
  }));
}

export async function getRuntimeForecast(): Promise<ForecastResult> {
  const rows = await getRuntimeRows();
  return forecastVram(rowsToForecastModels(rows));
}
