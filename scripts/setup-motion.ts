/**
 * Registers HY-Motion (hy-motion-1) in the gateway WITHOUT a destructive re-seed.
 * Idempotent (upserts). Sets "Motion Generation" Online, ensures the admin has
 * Motion access, and prints a usable admin API key for verification.
 *
 *   npx tsx scripts/setup-motion.ts
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

// --- inline crypto (same scheme as prisma/seed.ts) ---
function encKey(): Buffer {
  const hex = process.env.API_KEY_ENC_KEY;
  if (!hex || hex.length !== 64) throw new Error("API_KEY_ENC_KEY must be 64 hex chars");
  return Buffer.from(hex, "hex");
}
function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([d.update(Buffer.from(dataHex, "hex")), d.final()]).toString("utf8");
}
function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}
function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function main() {
  const MODEL_ID = "hy-motion-1";

  await prisma.modelRegistry.upsert({
    where: { modelId: MODEL_ID },
    update: { installed: true, backend: "HY-Motion", modelName: "HY-Motion 1.0" },
    create: {
      modelId: MODEL_ID,
      category: "Motion",
      function: "Text → 3D body motion (SMPL→VMD)",
      modelName: "HY-Motion 1.0",
      backend: "HY-Motion",
      installed: true,
      estimatedVramMinGb: 6,
      estimatedVramMaxGb: 12,
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
      modelSizeClass: "Medium",
      enabled: true,
      maxConcurrent: 1,
      autoShutdownMinutes: 0,
    },
  });

  await prisma.modelRuntimeState.upsert({
    where: { modelId: MODEL_ID },
    update: { currentStatus: "Running", devicePlan: "1GPU", actualDevice: "GPU1" },
    create: {
      modelId: MODEL_ID,
      currentStatus: "Running",
      devicePlan: "1GPU",
      actualDevice: "GPU1",
      predictedVramGb: 8,
      currentVramMb: 0,
    },
  });

  await prisma.apiStatus.upsert({
    where: { apiName: "Motion Generation" },
    update: { status: "Online", currentModel: "HY-Motion 1.0", backend: "HY-Motion", mode: "Sync", usesGpu: true, adminDisabled: false },
    create: {
      apiName: "Motion Generation",
      category: "Motion",
      status: "Online",
      currentModel: "HY-Motion 1.0",
      backend: "HY-Motion",
      mode: "Sync",
      usesGpu: true,
      description: "English text → MMD .vmd body motion (HY-Motion 1.0).",
    },
  });

  // Ensure the admin can access the Motion category.
  const admin = await prisma.user.findFirst({ where: { role: "admin" }, include: { apiKeys: true } });
  if (!admin) throw new Error("no admin user found");
  await prisma.apiAccess.upsert({
    where: { userId_category: { userId: admin.id, category: "Motion" } },
    update: { enabled: true },
    create: { userId: admin.id, category: "Motion", enabled: true },
  });

  // Surface a usable admin key (decrypt existing active, else mint one).
  let rawKey: string | null = null;
  const active = admin.apiKeys.find((k) => k.status === "active" && !k.revokedAt);
  if (active) {
    try { rawKey = decryptSecret(active.keyEncrypted); } catch { rawKey = null; }
  }
  if (!rawKey) {
    const raw = `lag_${crypto.randomBytes(24).toString("base64url")}`;
    await prisma.apiKey.create({
      data: { userId: admin.id, keyHash: hashKey(raw), keyEncrypted: encryptSecret(raw), keyPrefix: raw.slice(0, 8), last4: raw.slice(-4) },
    });
    rawKey = raw;
  }

  console.log("hy-motion-1 registered; Motion Generation = Online; admin Motion access ensured.");
  console.log("ADMIN_KEY=" + rawKey);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
