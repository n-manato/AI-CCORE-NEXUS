"use client";

import { cn } from "@/lib/cn";
import { usageColor } from "@/components/charts/palette";

// SVG circular usage meter (like a game graphics-settings VRAM gauge). Uses real
// or predicted data only - no decorative-only filling.
export function CircularUsageMeter({
  value,
  max = 100,
  label,
  sublabel,
  unit = "%",
  size = 120,
  color,
}: {
  value: number;
  max?: number;
  label?: string;
  sublabel?: string;
  unit?: string;
  size?: number;
  color?: string;
}) {
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * frac;
  const meterColor = color ?? usageColor(frac);
  const display = unit === "%" ? Math.round(frac * 100) : value;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="#1e2c45" strokeWidth={stroke} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={meterColor}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            style={{
              transition: "stroke-dasharray 0.6s ease, stroke 0.4s ease",
              filter: `drop-shadow(0 0 6px ${meterColor}66)`,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold text-ink">
            {display}
            <span className="ml-0.5 text-xs text-muted">{unit}</span>
          </span>
          {sublabel && <span className="mt-0.5 text-[10px] text-muted">{sublabel}</span>}
        </div>
      </div>
      {label && <span className={cn("mt-2 text-xs text-ink-dim")}>{label}</span>}
    </div>
  );
}
