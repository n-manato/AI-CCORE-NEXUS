/**
 * Registers TRELLIS.2 (trellis-2) in the gateway, mirroring setup-gesture.ts.
 * Idempotent (upserts). Marks "3D Generation" installed + Offline (it flips to
 * Online once trellis-service answers /healthz) and ensures admin "3D" access so
 * POST /v1/3d/generations stops returning "API not installed".
 *
 * Run AFTER trellis-service/install_trellis.sh has installed the weights:
 *   npx tsx scripts/setup-trellis.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const MODEL_ID = "trellis-2";

  await prisma.modelRegistry.upsert({
    where: { modelId: MODEL_ID },
    update: { installed: true, backend: "TRELLIS", modelName: "TRELLIS.2-4B", estimatedVramMinGb: 14, estimatedVramMaxGb: 18, defaultDeviceRule: "1GPU", multiGpuSupported: false },
    create: {
      modelId: MODEL_ID,
      category: "3D",
      function: "Image → PBR-textured 3D asset (GLB)",
      modelName: "TRELLIS.2-4B",
      backend: "TRELLIS",
      installed: true,
      // 512-res resident footprint (~16-18GB); NOT the transient high-res GLB-
      // extraction peak (24-30GB), which would spuriously trip "Over Limit" on a
      // lone 24GB card. Runtime scheduler still guards OOM via live nvidia-smi.
      estimatedVramMinGb: 14,
      estimatedVramMaxGb: 18,
      defaultDeviceRule: "1GPU",
      multiGpuSupported: false,
    },
  });

  await prisma.modelRuntimeConfig.upsert({
    where: { modelId: MODEL_ID },
    update: { enabled: true, startupPolicy: "On Demand", runtimeType: "Sync", maxConcurrent: 1, autoShutdownMinutes: 0 },
    create: {
      modelId: MODEL_ID,
      startupPolicy: "On Demand",
      runtimeType: "Sync",
      modelSizeClass: "XLarge",
      enabled: true,
      maxConcurrent: 1,
      autoShutdownMinutes: 0,
    },
  });

  await prisma.modelRuntimeState.upsert({
    where: { modelId: MODEL_ID },
    update: { currentStatus: "Stopped", devicePlan: "1GPU", actualDevice: null, predictedVramGb: 18 },
    create: {
      modelId: MODEL_ID,
      currentStatus: "Stopped",
      devicePlan: "1GPU",
      actualDevice: null,
      predictedVramGb: 18,
      currentVramMb: 0,
    },
  });

  await prisma.apiStatus.upsert({
    where: { apiName: "3D Generation" },
    update: { status: "Offline", currentModel: "TRELLIS.2-4B", backend: "TRELLIS", mode: "Sync", usesGpu: true, adminDisabled: false },
    create: {
      apiName: "3D Generation",
      category: "3D",
      status: "Offline",
      currentModel: "TRELLIS.2-4B",
      backend: "TRELLIS",
      mode: "Sync",
      usesGpu: true,
      description: "Single image → PBR-textured 3D asset (GLB) via TRELLIS.2.",
    },
  });

  // Ensure the admin can access the new "3D" category.
  const admin = await prisma.user.findFirst({ where: { role: "admin" } });
  if (!admin) throw new Error("no admin user found");
  await prisma.apiAccess.upsert({
    where: { userId_category: { userId: admin.id, category: "3D" } },
    update: { enabled: true },
    create: { userId: admin.id, category: "3D", enabled: true },
  });

  console.log("trellis-2 registered; 3D Generation installed (Offline until the service is up); admin 3D access ensured.");
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
