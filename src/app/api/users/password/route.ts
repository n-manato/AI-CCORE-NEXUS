import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAdmin } from "@/lib/api-auth";
import { hashPassword } from "@/lib/auth";
import { writeAudit, clientIp } from "@/lib/audit";

const Body = z.object({
  userId: z.string().min(1),
  password: z.string().min(8).max(128),
});

// Admin: replace any user's login password. The plaintext and hash are never audited.
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Password must be 8–128 characters." }, { status: 400 });
  }

  const { userId, password } = parsed.data;
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password) },
  });

  await writeAudit({
    adminId: guard.user.id,
    targetUserId: userId,
    action: "USER_PASSWORD_CHANGE",
    afterValue: "password changed",
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ ok: true });
}
