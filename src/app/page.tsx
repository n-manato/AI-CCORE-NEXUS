import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// The middleware normally handles "/", but keep a server-side fallback.
export default async function Home() {
  const claims = await getSession();
  redirect(claims ? (claims.role === "admin" ? "/admin/dashboard" : "/user/my-access") : "/login");
}
