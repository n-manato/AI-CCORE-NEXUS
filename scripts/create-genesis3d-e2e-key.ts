/**
 * Genesis3D の E2E 検証専用のサービスアカウントと API キーを作る。
 *
 * 既存ユーザーの鍵は使わない。ApiKey は個人のアカウントに紐づいており、
 * 復号も他人名義での発行もすべきでないため、検証用に切り離した口を用意する。
 *
 * 生成した鍵は Genesis3D/.env の GENESIS_API_KEY に書き込む。**標準出力には
 * 出さない** — ログや端末履歴に残さないため。取り消すときは管理画面か
 *   UPDATE ApiKey SET status='revoked' WHERE keyPrefix='...';
 *
 *   npx tsx scripts/create-genesis3d-e2e-key.ts
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { generateApiKey } from "../src/lib/apikey";

const prisma = new PrismaClient();

const EMAIL = "genesis3d-e2e@localhost";
const ENV_PATH = "/home/ai-ccore/Documents/DEV/Genesis3D/.env";

async function main() {
  // パスワードでのログインはさせない。ランダムなハッシュを置いて口を塞ぐ。
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { status: "active" },
    create: {
      email: EMAIL,
      name: "Genesis3D E2E (service account)",
      passwordHash: crypto.randomBytes(32).toString("hex"),
      role: "user",
      status: "active",
    },
  });

  // 3D カテゴリだけ許可する。他のカテゴリは触らせない。
  await prisma.apiAccess.upsert({
    where: { userId_category: { userId: user.id, category: "3D" } },
    update: { enabled: true },
    create: { userId: user.id, category: "3D", enabled: true },
  });

  // 既存の鍵があれば失効させてから新しく発行する（重複を残さない）。
  await prisma.apiKey.updateMany({
    where: { userId: user.id, status: "active" },
    data: { status: "revoked", revokedAt: new Date() },
  });
  const key = generateApiKey();
  await prisma.apiKey.create({
    data: {
      userId: user.id,
      keyHash: key.keyHash,
      keyEncrypted: key.keyEncrypted,
      keyPrefix: key.keyPrefix,
      last4: key.last4,
      status: "active",
    },
  });

  // .env へ書き込む。既存行は置き換える。
  let env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const line = `GENESIS_API_KEY="${key.raw}"`;
  if (/^GENESIS_API_KEY=.*$/m.test(env)) {
    env = env.replace(/^GENESIS_API_KEY=.*$/m, line);
  } else {
    env = env.replace(/^GATEWAY_API_KEY=/m, `${line}\n# Gateway 経由の E2E 用（サービスアカウント ${EMAIL}）\nGATEWAY_API_KEY=`);
  }
  fs.writeFileSync(ENV_PATH, env);

  console.log(`user      : ${EMAIL}`);
  console.log(`category  : 3D (enabled)`);
  console.log(`key prefix: ${key.keyPrefix}...${key.last4}`);
  console.log(`written to: ${path.basename(ENV_PATH)} (GENESIS_API_KEY)`);
}

main().finally(() => prisma.$disconnect());
