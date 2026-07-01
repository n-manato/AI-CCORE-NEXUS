import { Wrench } from "lucide-react";
import type { Role } from "@/lib/constants";

// Shown when maintenance mode is On. Admins get an operational notice; normal
// users get the standard "try again later" message.
export function MaintenanceBanner({ role }: { role: Role }) {
  const message =
    role === "admin"
      ? "Maintenance Mode is ON. New API requests are temporarily disabled."
      : "The system is currently under maintenance. Please try again later.";
  return (
    <div className="flex items-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn">
      <Wrench className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
