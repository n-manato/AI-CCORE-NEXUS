import { Cpu, Server, Layers, Ban, PackageX } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import type { DevicePlan } from "@/lib/constants";

const META: Record<DevicePlan, { tone: Tone; icon: React.ReactNode }> = {
  CPU: { tone: "muted", icon: <Cpu className="h-3.5 w-3.5" /> },
  "1GPU": { tone: "accent", icon: <Server className="h-3.5 w-3.5" /> },
  "2GPU": { tone: "warn", icon: <Layers className="h-3.5 w-3.5" /> },
  Disabled: { tone: "muted", icon: <Ban className="h-3.5 w-3.5" /> },
  "Not Installed": { tone: "neutral", icon: <PackageX className="h-3.5 w-3.5" /> },
};

// Read-only, system-calculated device plan. The reason is shown on hover.
export function DevicePlanBadge({ plan, reason }: { plan: DevicePlan; reason?: string }) {
  const m = META[plan] ?? META["1GPU"];
  return (
    <span title={reason} className="inline-flex">
      <Badge tone={m.tone} dot={false} className="gap-1">
        {m.icon}
        {plan}
      </Badge>
    </span>
  );
}
