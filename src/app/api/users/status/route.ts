import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAdmin } from "@/lib/api-auth";
import { writeAudit, clientIp } from "@/lib/audit";

const Body = z.object({
  userId: z.string().min(1),
  status: z.enum(["active", "disabled"]),
});

// Admin: enable or disable a user account.
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { userId, status } = parsed.data;

  if (userId === guard.user.id && status === "disabled") {
    return NextResponse.json({ error: "You cannot disable your own account." }, { status: 409 });
  }

  const before = await prisma.user.findUnique({ where: { id: userId } });
  if (!before) return NextResponse.json({ error: "User not found" }, { status: 404 });

  await prisma.user.update({ where: { id: userId }, data: { status } });

  await writeAudit({
    adminId: guard.user.id,
    targetUserId: userId,
    action: status === "disabled" ? "USER_DISABLE" : "USER_ENABLE",
    beforeValue: `status=${before.status}`,
    afterValue: `status=${status}`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ ok: true });
}
