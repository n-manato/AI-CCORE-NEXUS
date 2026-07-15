/**
 * Registers GestureLSM (gesturelsm-1) in the gateway, mirroring setup-motion.ts.
 * Idempotent (upserts). Marks "Gesture Generation" Online + ensures admin Motion
 * access so POST /v1/gesture stops returning "API not installed".
 *
 *   npx tsx scripts/setup-gesture.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const MODEL_ID = "gesturelsm-1";

  await prisma.modelRegistry.upsert({
    where: { modelId: MODEL_ID },
    update: { installed: true, backend: "GestureLSM", modelName: "GestureLSM (shortcut)" },
    create: {
      modelId: MODEL_ID,
      category: "Motion",
      function: "Speech audio → co-speech 3D body motion (SMPL-X joints)",
      modelName: "GestureLSM (shortcut)",
      backend: "GestureLSM",
      installed: true,
      estimatedVramMinGb: 3,
      estimatedVramMaxGb: 6,
      defaultDeviceRule: "1GPU",
      multiGpuSupported: false,
    },
  });

  await prisma.modelRuntimeConfig.upsert({
    where: { modelId: MODEL_ID },
    update: { enabled: true, startupPolicy: "Always Running", runtimeType: "Sync", maxConcurrent: 1, autoShutdownMinutes: 0 },
    create: {
      modelId: MODEL_ID,
      startupPolicy: "Always Running",
      runtimeType: "Sync",
      modelSizeClass: "Small",
      enabled: true,
      maxConcurrent: 1,
      autoShutdownMinutes: 0,
    },
  });

  await prisma.modelRuntimeState.upsert({
    where: { modelId: MODEL_ID },
    update: { currentStatus: "Running", devicePlan: "1GPU", actualDevice: "GPU0" },
    create: {
      modelId: MODEL_ID,
      currentStatus: "Running",
      devicePlan: "1GPU",
      actualDevice: "GPU0",
      predictedVramGb: 4,
      currentVramMb: 0,
    },
  });

  await prisma.apiStatus.upsert({
    where: { apiName: "Gesture Generation" },
    update: { status: "Online", currentModel: "GestureLSM (shortcut)", backend: "GestureLSM", mode: "Sync", usesGpu: true, adminDisabled: false },
    create: {
      apiName: "Gesture Generation",
      category: "Motion",
      status: "Online",
      currentModel: "GestureLSM (shortcut)",
      backend: "GestureLSM",
      mode: "Sync",
      usesGpu: true,
      description: "Speech audio (+text) → SMPL-X co-speech body motion (GestureLSM).",
    },
  });

  // Ensure the admin can access the Motion category (gesture shares it).
  const admin = await prisma.user.findFirst({ where: { role: "admin" } });
  if (!admin) throw new Error("no admin user found");
  await prisma.apiAccess.upsert({
    where: { userId_category: { userId: admin.id, category: "Motion" } },
    update: { enabled: true },
    create: { userId: admin.id, category: "Motion", enabled: true },
  });

  console.log("gesturelsm-1 registered; Gesture Generation = Online; admin Motion access ensured.");
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
