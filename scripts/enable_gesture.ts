import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const r = await p.apiStatus.update({
    where: { apiName: "Gesture Generation" },
    data: { status: "Online", adminDisabled: false, currentModel: "GestureLSM (shortcut)", backend: "GestureLSM", mode: "Sync", usesGpu: true },
  });
  console.log("SET " + r.apiName + " => " + r.status);
  await p.$disconnect();
})().catch(async (e) => { console.error("ERR", e.message); await p.$disconnect(); });
