import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

const toneText: Record<Tone, string> = {
  neutral: "text-ink",
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
};

// Compact KPI card for the dashboard grid.
export function MetricCard({
  label,
  value,
  unit,
  sublabel,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  unit?: string;
  sublabel?: string;
  icon?: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <Card glow className="animate-fade-up">
      <div className="flex items-start justify-between p-4">
        <div className="min-w-0">
          <div className="text-xs text-muted">{label}</div>
          <div className={cn("mt-1 text-2xl font-semibold tracking-tight", toneText[tone])}>
            {value}
            {unit && <span className="ml-1 text-sm font-normal text-muted">{unit}</span>}
          </div>
          {sublabel && <div className="mt-1 text-xs text-ink-dim">{sublabel}</div>}
        </div>
        {icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-hover text-accent">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
