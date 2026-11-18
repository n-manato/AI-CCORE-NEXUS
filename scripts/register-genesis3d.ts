/**
 * Genesis3D を稼働中の Gateway DB へ登録する（追加のみ・冪等）。
 *
 * seed.ts はフルセットアップ時にしか走らないため、既存の dev.db には
 * この upsert で行を足す。既存データには一切触れない。
 *
 *   npx tsx scripts/register-genesis3d.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const modelId = "genesis3d";

  // VRAM の見積りは update 側にも書く。ここを create だけにしていたため、
  // 実測に合わせて値を直しても再実行が無反応だった。
  const vram = { estimatedVramMinGb: 3, estimatedVramMaxGb: 14 };

  await prisma.modelRegistry.upsert({
    where: { modelId },
    update: { installed: true, ...vram },
    create: {
      modelId,
      category: "3D",
      function: "Image → rigged VRM 1.0 character (multi-candidate + auto evaluation)",
      modelName: "Genesis3D",
      backend: "Genesis3D",
      installed: true,
      // Genesis3D 自体は重みを持たない。この範囲は GPU0 で走る短命サブプロセス
      // のピーク値。実測(2026-08-24):
      //   RMBG-2.0            3.0GB
      //   Blender EEVEE       ~2GB
      //   参照ビュー生成       13.9GB  ← 現在の最大
      //     (SDXL RealVisXL + ControlNet-OpenPose / multiview/generate_views.py)
      //   PSHuman(未導入)     ~16GB   導入時にここを 16 へ上げること
      // 注意: GPU0 は Genesis3D 専有ではない。actionplan_service(:8893) と
      // :8000 のサイドカーが常時 9GB 使っており、参照ビュー生成時の GPU0 合計は
      // 23.2GB / 24GB まで上がる（余裕 1.3GB）。
      ...vram,
      defaultDeviceRule: "1GPU",
      multiGpuSupported: false,
      separateProcessPerRequest: false,
    },
  });

  await prisma.modelRuntimeConfig.upsert({
    where: { modelId },
    update: { enabled: true },
    create: {
      modelId,
      startupPolicy: "On Demand",
      runtimeType: "Job",
      modelSizeClass: "Large",
      enabled: true,
      maxConcurrent: 1,
      autoShutdownMinutes: 0,
    },
  });

  await prisma.modelRuntimeState.upsert({
    where: { modelId },
    update: {},
    create: {
      modelId,
      currentStatus: "Stopped",
      devicePlan: "1GPU",
      predictedVramGb: 12,
      currentVramMb: 0,
    },
  });

  await prisma.apiStatus.upsert({
    where: { apiName: "3D Character" },
    update: { status: "Online", backend: "Genesis3D", currentModel: "Genesis3D" },
    create: {
      apiName: "3D Character",
      category: "3D",
      status: "Online",
      currentModel: "Genesis3D",
      backend: "Genesis3D",
      mode: "Job",
      usesGpu: true,
      description:
        "Single image → rigged VRM 1.0 character via Genesis3D. Asynchronous: POST returns a job_id, poll /v1/3d/characters/{id}.",
    },
  });

  const m = await prisma.modelRegistry.findUnique({
    where: { modelId },
    include: { runtimeConfig: true, runtimeState: true },
  });
  const api = await prisma.apiStatus.findUnique({ where: { apiName: "3D Character" } });
  console.log("ModelRegistry :", m?.modelId, "installed=", m?.installed,
              "vram=", m?.estimatedVramMinGb + "-" + m?.estimatedVramMaxGb + "GB");
  console.log("RuntimeConfig :", m?.runtimeConfig?.startupPolicy,
              "enabled=", m?.runtimeConfig?.enabled);
  console.log("ApiStatus     :", api?.apiName, api?.status, "category=", api?.category);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
