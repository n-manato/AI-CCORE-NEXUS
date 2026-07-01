import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAdmin } from "@/lib/api-auth";
import { hashPassword } from "@/lib/auth";
import { generateApiKey } from "@/lib/apikey";
import { writeAudit, clientIp } from "@/lib/audit";
import { CATEGORIES } from "@/lib/constants";

const Body = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "user"]).default("user"),
  access: z.record(z.string(), z.boolean()).optional(),
});

// Admin: create a new user with access rows and an initial API key.
export async function POST(req: Request) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request format." }, { status: 400 });
  }
  const { name, email, password, role, access } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return NextResponse.json({ error: "Email already in use." }, { status: 409 });

  const user = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      role,
      status: "active",
      apiAccess: {
        create: CATEGORIES.map((c) => ({ category: c, enabled: !!access?.[c] })),
      },
    },
  });

  const k = generateApiKey();
  await prisma.apiKey.create({
    data: {
      userId: user.id,
      keyHash: k.keyHash,
      keyEncrypted: k.keyEncrypted,
      keyPrefix: k.keyPrefix,
      last4: k.last4,
      status: "active",
    },
  });

  await writeAudit({
    adminId: guard.user.id,
    targetUserId: user.id,
    action: "USER_CREATE",
    afterValue: `name=${name}; role=${role}`,
    ipAddress: clientIp(req.headers),
  });

  return NextResponse.json({ userId: user.id, key: k.raw });
}
