import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

// Guards for management API route handlers (distinct from the /v1 gateway auth).

export async function requireApiUser(): Promise<
  { ok: true; user: User } | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true, user };
}

export async function requireApiAdmin(): Promise<
  { ok: true; user: User } | { ok: false; response: NextResponse }
> {
  const res = await requireApiUser();
  if (!res.ok) return res;
  if (res.user.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return res;
}
