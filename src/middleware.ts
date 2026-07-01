import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";

// Edge middleware for role-based route protection. It only inspects the signed
// session cookie (no DB access); server components re-verify against the DB.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const claims = await verifySession(token);

  const home = (role?: string) =>
    role === "admin" ? "/admin/dashboard" : "/user/my-access";

  // Root: send to the right place. (The /login page itself decides whether to
  // bounce an already-logged-in user, using a real DB check, so a stale but
  // validly-signed cookie cannot create a /login <-> /admin redirect loop.)
  if (pathname === "/") {
    return NextResponse.redirect(new URL(claims ? home(claims.role) : "/login", req.url));
  }

  if (pathname.startsWith("/admin")) {
    if (!claims) return NextResponse.redirect(new URL("/login", req.url));
    if (claims.role !== "admin") {
      return NextResponse.redirect(new URL("/user/my-access", req.url));
    }
  }

  if (pathname.startsWith("/user")) {
    if (!claims) return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/admin/:path*", "/user/:path*"],
};
