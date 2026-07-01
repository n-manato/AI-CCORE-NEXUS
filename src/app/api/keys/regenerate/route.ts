import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/api-auth";
import { generateApiKey } from "@/lib/apikey";
import { writeAudit, clientIp } from "@/lib/audit";

const Body = z.object({ userId: z.string().min(1) });

// Regenerates a user's API key: the previous key is immediately revoked and a
// new one is issued. Returns the new raw key once. Allowed for owner or admin.
export async function POST(req: Request) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  const me = guard.user;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { userId } = parsed.data;

  if (me.role !== "admin" && me.id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const k = generateApiKey();
  await prisma.$transaction([
    // Revoke all currently active keys for the user.
    prisma.apiKey.updateMany({
      where: { userId, status: "active" },
      data: { status: "disabled", revokedAt: new Date() },
    }),
    prisma.apiKey.create({
      data: {
        userId,
        keyHash: k.keyHash,
        keyEncrypted: k.keyEncrypted,
        keyPrefix: k.keyPrefix,
        last4: k.last4,
        status: "active",
      },
    }),
  ]);

  await writeAudit({
    adminId: me.id,
    targetUserId: userId,
    action: "API_KEY_REGENERATE",
    afterValue: `new key ${k.keyPrefix}...${k.last4}`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ key: k.raw, prefix: k.keyPrefix, last4: k.last4 });
}
