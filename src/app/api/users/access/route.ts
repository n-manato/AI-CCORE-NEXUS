import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAdmin } from "@/lib/api-auth";
import { writeAudit, clientIp } from "@/lib/audit";
import { CATEGORIES, type Category } from "@/lib/constants";

const Body = z.object({
  userId: z.string().min(1),
  access: z.record(z.string(), z.boolean()),
});

// Admin: update a user's per-category API access. Records before/after in audit.
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { userId, access } = parsed.data;

  const before = await prisma.apiAccess.findMany({ where: { userId } });
  const beforeStr = before
    .filter((a) => a.enabled)
    .map((a) => a.category)
    .join(",");

  for (const c of CATEGORIES) {
    if (!(c in access)) continue;
    await prisma.apiAccess.upsert({
      where: { userId_category: { userId, category: c as Category } },
      update: { enabled: access[c] },
      create: { userId, category: c, enabled: access[c] },
    });
  }

  const afterStr = CATEGORIES.filter((c) => access[c] ?? before.find((b) => b.category === c)?.enabled).join(",");

  await writeAudit({
    adminId: guard.user.id,
    targetUserId: userId,
    action: "API_ACCESS_CHANGE",
    beforeValue: `enabled=[${beforeStr}]`,
    afterValue: `enabled=[${afterStr}]`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ ok: true });
}
