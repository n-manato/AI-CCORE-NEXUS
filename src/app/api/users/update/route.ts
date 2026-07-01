import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAdmin } from "@/lib/api-auth";
import { writeAudit, clientIp } from "@/lib/audit";

const Body = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "user"]).optional(),
});

// Admin: update a user's display name and/or role.
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { userId, name, role } = parsed.data;

  const before = await prisma.user.findUnique({ where: { id: userId } });
  if (!before) return NextResponse.json({ error: "User not found" }, { status: 404 });

  await prisma.user.update({
    where: { id: userId },
    data: { ...(name ? { name } : {}), ...(role ? { role } : {}) },
  });

  await writeAudit({
    adminId: guard.user.id,
    targetUserId: userId,
    action: "USER_UPDATE",
    beforeValue: `name=${before.name}; role=${before.role}`,
    afterValue: `name=${name ?? before.name}; role=${role ?? before.role}`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ ok: true });
}
