"use client";

import { TEMP_WARNING, TEMP_CRITICAL } from "@/lib/constants";
import { CHART } from "@/components/charts/palette";

// Semicircular temperature gauge with Normal / Warning / Critical thresholds.
export function TemperatureGauge({
  tempC,
  label,
  min = 30,
  max = 100,
  size = 150,
}: {
  tempC: number;
  label?: string;
  min?: number;
  max?: number;
  size?: number;
}) {
  const frac = Math.max(0, Math.min(1, (tempC - min) / (max - min)));
  const r = (size - 18) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = Math.PI; // 180deg
  const endAngle = 0; // 0deg
  const angle = startAngle + (endAngle - startAngle) * frac;

  const color =
    tempC >= TEMP_CRITICAL ? CHART.danger : tempC >= TEMP_WARNING ? CHART.warn : CHART.ok;
  const stateText =
    tempC >= TEMP_CRITICAL ? "Critical" : tempC >= TEMP_WARNING ? "Warning" : "Normal";

  const arc = (from: number, to: number) => {
    const x1 = cx + r * Math.cos(from);
    const y1 = cy - r * Math.sin(from);
    const x2 = cx + r * Math.cos(to);
    const y2 = cy - r * Math.sin(to);
    const large = Math.abs(to - from) > Math.PI ? 1 : 0;
    const sweep = to < from ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`;
  };

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 16}>
        <path d={arc(startAngle, endAngle)} stroke="#1e2c45" strokeWidth={10} fill="none" strokeLinecap="round" />
        <path
          d={arc(startAngle, angle)}
          stroke={color}
          strokeWidth={10}
          fill="none"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 5px ${color}66)` }}
        />
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-ink text-lg font-semibold">
          {Math.round(tempC)}&deg;C
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-muted text-[10px]">
          {stateText}
        </text>
      </svg>
      {label && <span className="mt-1 text-xs text-ink-dim">{label}</span>}
    </div>
  );
}
