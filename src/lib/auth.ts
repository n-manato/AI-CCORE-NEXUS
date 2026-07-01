import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  SESSION_COOKIE,
  signSession,
  verifySession,
  type SessionClaims,
} from "@/lib/jwt";
import type { Role } from "@/lib/constants";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Issues a session cookie for the given user.
export async function startSession(user: {
  id: string;
  role: string;
  name: string;
  email: string;
}): Promise<void> {
  const { token, maxAge } = await signSession({
    sub: user.id,
    role: user.role as Role,
    name: user.name,
    email: user.email,
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

// Returns the verified session claims, or null if not logged in.
export async function getSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return verifySession(token);
}

// Resolves the live user record for the current session (re-checks status/role
// against the database rather than trusting the cookie alone).
export async function getCurrentUser() {
  const claims = await getSession();
  if (!claims?.sub) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || user.status === "disabled") return null;
  return user;
}

// For server components: require a logged-in user or redirect to /login.
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// For server components: require an admin or redirect.
export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/user/my-access");
  return user;
}
