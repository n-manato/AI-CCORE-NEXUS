import { redirect } from "next/navigation";
import { Activity } from "lucide-react";
import { LoginForm } from "@/app/login/login-form";
import { Card } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Sign in - Local AI Gateway" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Only bounce to the app if a REAL user backs the session. A stale cookie
  // (e.g. after the DB was re-seeded) falls through to the login form instead of
  // ping-ponging with the protected pages.
  const user = await getCurrentUser();
  if (user) redirect(user.role === "admin" ? "/admin/dashboard" : "/user/my-access");

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent shadow-glow">
            <Activity className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Local AI Gateway</h1>
          <p className="mt-1 text-sm text-muted">
            Research-lab AI API management - 2x RTX 3090
          </p>
        </div>

        <Card className="p-6">
          <LoginForm />
        </Card>

        <p className="mt-6 text-center text-xs text-muted">
          Access this site over VPN. Sessions expire automatically.
        </p>
      </div>
    </div>
  );
}
