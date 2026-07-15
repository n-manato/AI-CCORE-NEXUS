import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const s = await p.apiStatus.findMany({ select: { apiName: true, status: true, category: true } });
  console.log("APISTATUS " + JSON.stringify(s));
  const m = await p.modelRegistry.findMany({ select: { modelId: true, installed: true } });
  console.log("MODELS " + JSON.stringify(m));
  await p.$disconnect();
})().catch(async (e) => { console.error("ERR", e.message); await p.$disconnect(); });
