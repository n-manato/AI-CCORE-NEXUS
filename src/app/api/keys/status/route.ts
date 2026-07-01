import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/api-auth";
import { getActiveKey } from "@/lib/keys";
import { writeAudit, clientIp } from "@/lib/audit";

const Body = z.object({
  userId: z.string().min(1),
  status: z.enum(["active", "disabled"]),
});

// Enables or disables a user's API key. Owner or admin.
export async function POST(req: Request) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  const me = guard.user;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { userId, status } = parsed.data;

  if (me.role !== "admin" && me.id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (status === "disabled") {
    const key = await getActiveKey(userId);
    if (!key) return NextResponse.json({ error: "No active key" }, { status: 404 });
    await prisma.apiKey.update({
      where: { id: key.id },
      data: { status: "disabled", revokedAt: new Date() },
    });
  } else {
    // Re-enable the most recently revoked key.
    const key = await prisma.apiKey.findFirst({
      where: { userId, status: "disabled" },
      orderBy: { createdAt: "desc" },
    });
    if (!key) return NextResponse.json({ error: "No key to enable" }, { status: 404 });
    await prisma.apiKey.update({
      where: { id: key.id },
      data: { status: "active", revokedAt: null },
    });
  }

  await writeAudit({
    adminId: me.id,
    targetUserId: userId,
    action: status === "disabled" ? "API_KEY_DISABLE" : "API_KEY_ENABLE",
    afterValue: `key status -> ${status}`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ ok: true });
}
