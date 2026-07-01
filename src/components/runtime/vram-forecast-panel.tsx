"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { GPU_VRAM_GB, TOTAL_VRAM_GB } from "@/lib/constants";
import type { ForecastResult } from "@/lib/vram";
import { cn } from "@/lib/cn";

// A game-graphics-settings style VRAM meter. Uses predicted data only.
function VramBar({
  label,
  usedGb,
  maxGb,
  perGpu,
}: {
  label: string;
  usedGb: number;
  maxGb: number;
  perGpu: boolean; // single-GPU bar uses 70/85/95 thresholds; total bar does not
}) {
  const frac = Math.min(1, maxGb > 0 ? usedGb / maxGb : 0);
  const over = usedGb > maxGb;
  const pct = Math.round(frac * 100);

  // Color by per-GPU threshold for single GPU bars.
  const color = over
    ? "#f43f5e"
    : !perGpu
      ? "#22d3ee"
      : frac >= 0.95
        ? "#f43f5e"
        : frac >= 0.85
          ? "#f59e0b"
          : frac >= 0.7
            ? "#f59e0b"
            : "#34d399";

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-ink-dim">{label}</span>
        <span className={cn("font-mono text-xs", over ? "text-danger" : "text-ink")}>
          {usedGb.toFixed(1)} / {maxGb} GB
          <span className="ml-1 text-muted">({pct}%)</span>
        </span>
      </div>
      <div className="relative h-4 overflow-hidden rounded-md border border-border bg-bg-base">
        {/* segmented backdrop ticks */}
        {perGpu &&
          [70, 85, 95].map((t) => (
            <div
              key={t}
              className="absolute top-0 h-full w-px bg-border-strong"
              style={{ left: `${t}%` }}
            />
          ))}
        <div
          className="h-full rounded-md transition-all duration-500"
          style={{
            width: `${Math.min(100, frac * 100)}%`,
            background: `linear-gradient(90deg, ${color}cc, ${color})`,
            boxShadow: `0 0 10px -1px ${color}aa inset`,
          }}
        />
      </div>
    </div>
  );
}

export function VramForecastPanel({ forecast }: { forecast: ForecastResult }) {
  const top = [...forecast.contributors]
    .filter((c) => c.vramGb > 0)
    .sort((a, b) => b.vramGb - a.vramGb)
    .slice(0, 4);

  return (
    <Card glow>
      <CardHeader>
        <CardTitle>VRAM Forecast (predicted)</CardTitle>
        <StatusBadge status={forecast.status} />
      </CardHeader>
      <CardContent className="space-y-3">
        <VramBar label="GPU 0" usedGb={forecast.gpu0Gb} maxGb={GPU_VRAM_GB} perGpu />
        <VramBar label="GPU 1" usedGb={forecast.gpu1Gb} maxGb={GPU_VRAM_GB} perGpu />
        <div className="border-t border-border pt-3">
          <VramBar label="Total" usedGb={forecast.totalGb} maxGb={TOTAL_VRAM_GB} perGpu={false} />
        </div>

        <div className="rounded-lg border border-border bg-bg-base/60 p-2.5">
          <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">Top VRAM consumers</div>
          {top.length === 0 ? (
            <div className="text-xs text-muted">No GPU-resident models in this configuration.</div>
          ) : (
            <ul className="space-y-1">
              {top.map((c) => (
                <li key={c.modelId} className="flex items-center justify-between text-xs">
                  <span className="text-ink-dim">{c.modelName}</span>
                  <span className="font-mono text-muted">
                    {c.vramGb}GB - {c.device}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-[11px] text-muted">
          Planning estimate (worst case: all enabled models resident). Two independent 24GB cards -
          never one 48GB pool. A 1GPU model uses ONE whole card (not split), so only one bar rises.
          The planner balances models onto the emptier card, so the GPU 0/1 here is an estimate -
          Ollama picks the actual card at load time. See the Dashboard for live per-card usage. A
          model spans both cards only with a 2GPU + multi-GPU backend.
        </p>
      </CardContent>
    </Card>
  );
}
