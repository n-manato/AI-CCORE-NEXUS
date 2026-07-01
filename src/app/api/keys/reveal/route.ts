import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api-auth";
import { getActiveKey } from "@/lib/keys";
import { decryptSecret } from "@/lib/crypto";
import { writeAudit, clientIp } from "@/lib/audit";

const Body = z.object({ userId: z.string().min(1) });

// Reveals a user's full API key. Allowed for the key owner or an admin.
// Writes an audit entry; the raw key itself is never logged.
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

  const key = await getActiveKey(userId);
  if (!key) return NextResponse.json({ error: "No active key" }, { status: 404 });

  const raw = decryptSecret(key.keyEncrypted);

  await writeAudit({
    adminId: me.id,
    targetUserId: userId,
    action: "API_KEY_VIEW",
    afterValue: `key ${key.keyPrefix}...${key.last4}`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ key: raw, prefix: key.keyPrefix, last4: key.last4 });
}
