"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART } from "@/components/charts/palette";

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

// Area/line chart for time series (e.g. requests over time). Supports one or
// more stacked-by-color series.
export function LineChartView({
  data,
  series,
  height = 240,
  xKey = "label",
  stacked = false,
}: {
  data: Record<string, number | string>[];
  series: SeriesDef[];
  height?: number;
  xKey?: string;
  stacked?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <XAxis dataKey={xKey} stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          contentStyle={{
            background: "#0c1220",
            border: "1px solid #1e2c45",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "#aab6cc" }}
        />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#grad-${s.key})`}
            stackId={stacked ? "1" : undefined}
            isAnimationActive
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
