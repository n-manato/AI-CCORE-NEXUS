import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAdmin } from "@/lib/api-auth";
import { writeAudit, clientIp } from "@/lib/audit";
import { OLLAMA_MAP, ollamaSetLoaded } from "@/lib/ollama";
import { SIDECAR_MODELS, sidecarUnload } from "@/lib/sidecar";
import { MOTION_MODELS } from "@/lib/motion";
import { startMotionService, stopMotionService } from "@/lib/motion-process";
import type { AdminAction } from "@/lib/constants";
import { noteModelResidency } from "@/lib/vram-scheduler";

const Body = z.object({
  modelId: z.string().min(1),
  action: z.enum(["unload", "reload"]),
});

const AUDIT: Record<string, AdminAction> = { unload: "UNLOAD_MODEL", reload: "RESTART_BACKEND" };

// Admin model lifecycle - REAL: Ollama models load/unload from VRAM via keep_alive;
// sidecar models unload via the sidecar /unload endpoint (load is lazy on next call).
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { modelId, action } = parsed.data;

  const model = await prisma.modelRegistry.findUnique({ where: { modelId } });
  if (!model) return NextResponse.json({ error: "Model not found" }, { status: 404 });
  if (!model.installed) return NextResponse.json({ error: "Model is not installed." }, { status: 409 });

  const ollamaTag = OLLAMA_MAP[modelId];
  const sidecarCap = SIDECAR_MODELS[modelId];
  const isMotion = modelId in MOTION_MODELS;

  try {
    if (ollamaTag) {
      await ollamaSetLoaded(ollamaTag, action === "reload");
    } else if (sidecarCap) {
      if (action === "unload") await sidecarUnload(sidecarCap);
      // sidecar "reload" is a no-op: the model loads lazily on the next request.
    } else if (isMotion) {
      // HY-Motion: start/stop the whole motion-service process (its model == VRAM).
      if (action === "reload") await startMotionService();
      else stopMotionService();
    } else {
      return NextResponse.json({ error: "No controllable backend for this model." }, { status: 409 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const running = action === "reload";
  noteModelResidency(modelId, running);
  await prisma.modelRuntimeState.update({
    where: { modelId },
    data: {
      currentStatus: running ? "Running" : "Stopped",
      currentVramMb: running ? Math.round(model.estimatedVramMaxGb * 1024) : 0,
      actualDevice: running ? (model.defaultDeviceRule === "CPU" ? "CPU" : "GPU0") : null,
      lastUsedAt: running ? new Date() : undefined,
      lastError: null,
    },
  });

  await writeAudit({
    adminId: guard.user.id,
    action: AUDIT[action],
    afterValue: `${model.modelName}: ${action === "reload" ? "loaded" : "unloaded"}`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ ok: true });
}
