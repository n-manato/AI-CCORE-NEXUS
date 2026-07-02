"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { SERIES } from "@/components/charts/palette";

export interface DonutDatum {
  name: string;
  value: number;
}

// Donut chart with an inline legend (e.g. API usage ratio).
export function DonutChartView({
  data,
  height = 240,
}: {
  data: DonutDatum[];
  height?: number;
}) {
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <ResponsiveContainer width="100%" height={height} className="max-w-[240px]">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="85%"
            paddingAngle={2}
            stroke="none"
            isAnimationActive
          >
            {data.map((_, i) => (
              <Cell key={i} fill={SERIES[i % SERIES.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "#0c1220",
              border: "1px solid #1e2c45",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#ffffff" }}
            itemStyle={{ color: "#ffffff" }}
          />
        </PieChart>
      </ResponsiveContainer>
      <ul className="grid w-full grid-cols-1 gap-1.5 text-xs sm:max-w-[200px]">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-ink-dim">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: SERIES[i % SERIES.length] }}
              />
              {d.name}
            </span>
            <span className="text-muted">
              {total > 0 ? Math.round((d.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
