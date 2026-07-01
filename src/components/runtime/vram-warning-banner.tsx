import { ShieldCheck, AlertTriangle, OctagonAlert, Ban } from "lucide-react";
import type { VramStatus } from "@/lib/constants";
import { cn } from "@/lib/cn";

const STYLE: Record<VramStatus, { cls: string; icon: React.ReactNode }> = {
  Safe: { cls: "border-ok/40 bg-ok/10 text-ok", icon: <ShieldCheck className="h-4 w-4" /> },
  Caution: { cls: "border-warn/40 bg-warn/10 text-warn", icon: <AlertTriangle className="h-4 w-4" /> },
  Warning: { cls: "border-warn/40 bg-warn/10 text-warn", icon: <AlertTriangle className="h-4 w-4" /> },
  Critical: { cls: "border-danger/40 bg-danger/10 text-danger", icon: <OctagonAlert className="h-4 w-4" /> },
  "Over Limit": { cls: "border-danger/50 bg-danger/15 text-danger", icon: <Ban className="h-4 w-4" /> },
  "Invalid Combination": { cls: "border-danger/50 bg-danger/15 text-danger", icon: <Ban className="h-4 w-4" /> },
};

export function VramWarningBanner({ status, reason }: { status: VramStatus; reason: string }) {
  const s = STYLE[status] ?? STYLE.Safe;
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", s.cls)}>
      <span className="mt-0.5 shrink-0">{s.icon}</span>
      <div>
        <span className="font-medium">{status}.</span> <span className="opacity-90">{reason}</span>
      </div>
    </div>
  );
}
