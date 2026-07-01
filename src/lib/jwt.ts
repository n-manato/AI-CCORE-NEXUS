import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { Role } from "@/lib/constants";

// Edge-safe (no Node-only deps) JWT helpers so they can be used from both
// middleware (edge runtime) and server components / route handlers.

export interface SessionClaims extends JWTPayload {
  sub: string; // user id
  role: Role;
  name: string;
  email: string;
}

export const SESSION_COOKIE = "lag_session";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set. See .env.example.");
  return new TextEncoder().encode(s);
}

function ttlSeconds(): number {
  const raw = Number(process.env.SESSION_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 8 * 60 * 60;
}

export async function signSession(claims: {
  sub: string;
  role: Role;
  name: string;
  email: string;
}): Promise<{ token: string; maxAge: number }> {
  const maxAge = ttlSeconds();
  const token = await new SignJWT({
    role: claims.role,
    name: claims.name,
    email: claims.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(secret());
  return { token, maxAge };
}

export async function verifySession(
  token: string | undefined,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || !payload.role) return null;
    return payload as SessionClaims;
  } catch {
    return null;
  }
}
