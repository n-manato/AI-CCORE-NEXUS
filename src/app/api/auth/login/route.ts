import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { startSession, verifyPassword } from "@/lib/auth";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request format." }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  // Always run a hash comparison shape to avoid trivial user enumeration timing.
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !ok) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  if (user.status === "disabled") {
    return NextResponse.json({ error: "This account is disabled." }, { status: 403 });
  }

  await startSession({ id: user.id, role: user.role, name: user.name, email: user.email });
  return NextResponse.json({ ok: true, role: user.role });
}
