import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAdmin } from "@/lib/api-auth";
import { getRuntimeRows, rowsToForecastModels, type RuntimeRow } from "@/lib/runtime";
import { forecastVram } from "@/lib/vram";
import { syncBackends } from "@/lib/sync";
import { reconcileModels } from "@/lib/worker";
import { writeAudit, clientIp } from "@/lib/audit";
import { STARTUP_POLICIES, MODEL_SIZE_CLASSES, MODES } from "@/lib/constants";

const ConfigSchema = z.object({
  modelId: z.string().min(1),
  startupPolicy: z.enum(STARTUP_POLICIES),
  runtimeType: z.enum(MODES),
  modelSizeClass: z.enum(MODEL_SIZE_CLASSES),
  enabled: z.boolean(),
  maxConcurrent: z.number().int().min(1).max(16),
});
const Body = z.object({
  configs: z.array(ConfigSchema),
  confirm: z.boolean().optional(),
});

// Admin: validate a proposed runtime configuration against the per-GPU VRAM
// budget, then persist it if allowed. Apply is blocked on Over Limit / Invalid
// Combination, and requires confirmation on Critical.
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { configs, confirm } = parsed.data;

  // Overlay proposed edits onto current rows (device plan stays system-derived).
  const rows = await getRuntimeRows();
  const byId = new Map(configs.map((c) => [c.modelId, c]));
  const merged: RuntimeRow[] = rows.map((r) => {
    const c = byId.get(r.modelId);
    return c ? { ...r, ...c } : r;
  });

  const forecast = forecastVram(rowsToForecastModels(merged));

  if (!forecast.canApply) {
    return NextResponse.json({ ok: false, blocked: true, forecast });
  }
  if (forecast.needsConfirm && !confirm) {
    return NextResponse.json({ ok: false, needsConfirm: true, forecast });
  }

  // Persist proposed configs.
  await prisma.$transaction(
    configs.map((c) =>
      prisma.modelRuntimeConfig.update({
        where: { modelId: c.modelId },
        data: {
          startupPolicy: c.startupPolicy,
          runtimeType: c.runtimeType,
          modelSizeClass: c.modelSizeClass,
          enabled: c.enabled,
          maxConcurrent: c.maxConcurrent,
        },
      }),
    ),
  );

  // Reflect the new config (Enabled -> API status) immediately, then enact it:
  // load Always-Running models / unload disabled ones now (in the background, so
  // Apply returns fast). No manual Load button needed.
  await syncBackends().catch(() => {});
  void reconcileModels().catch(() => {});

  await prisma.vramForecastSnapshot.create({
    data: {
      gpu0PredictedGb: forecast.gpu0Gb,
      gpu1PredictedGb: forecast.gpu1Gb,
      totalPredictedGb: forecast.totalGb,
      status: forecast.status,
      reason: forecast.reason,
    },
  });

  await writeAudit({
    adminId: guard.user.id,
    action: "RUNTIME_APPLY",
    afterValue: `GPU0=${forecast.gpu0Gb}GB GPU1=${forecast.gpu1Gb}GB total=${forecast.totalGb}GB status=${forecast.status}`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ ok: true, forecast });
}
