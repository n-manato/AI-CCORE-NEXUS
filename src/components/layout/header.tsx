import { Cpu, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { LogoutButton } from "@/components/layout/logout-button";
import type { Role, GpuStatusValue, MaintenanceState } from "@/lib/constants";

export function Header({
  name,
  role,
  gpuStatus,
  maintenance,
}: {
  name: string;
  role: Role;
  gpuStatus: GpuStatusValue;
  maintenance: MaintenanceState;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg-raised/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Activity className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight text-ink">Local AI Gateway</div>
          <div className="text-[10px] uppercase tracking-widest text-muted">
            2x RTX 3090 - GPU0 24GB / GPU1 24GB
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge tone="accent" className="gap-1.5">
          <Cpu className="h-3.5 w-3.5" />
          GPU: <StatusInline status={gpuStatus} />
        </Badge>
        {maintenance !== "Off" && <StatusBadge status={maintenance} />}
        <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <div className="hidden text-right leading-tight sm:block">
          <div className="text-xs font-medium text-ink">{name}</div>
        </div>
        <StatusBadge status={role} dot={false} />
        <LogoutButton />
      </div>
    </header>
  );
}

// Inline-colored GPU label inside the GPU badge.
function StatusInline({ status }: { status: GpuStatusValue }) {
  const color =
    status === "Available"
      ? "text-ok"
      : status === "Busy"
        ? "text-warn"
        : status === "Full"
          ? "text-danger"
          : "text-muted";
  return <span className={color}>{status}</span>;
}
