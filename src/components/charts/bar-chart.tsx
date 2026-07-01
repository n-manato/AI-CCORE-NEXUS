"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, SERIES } from "@/components/charts/palette";

// Bar chart (e.g. requests by user, errors by API). When `colorByIndex` is set,
// each bar gets a distinct hue from the palette. `showValues` prints the value
// at the end of each bar, and `labelWidth` widens the category axis so long
// names (users, API names) aren't truncated.
export function BarChartView({
  data,
  dataKey,
  xKey = "label",
  height = 240,
  color = CHART.accent,
  colorByIndex = false,
  horizontal = false,
  showValues = false,
  labelWidth = 110,
}: {
  data: Record<string, number | string>[];
  dataKey: string;
  xKey?: string;
  height?: number;
  color?: string;
  colorByIndex?: boolean;
  horizontal?: boolean;
  showValues?: boolean;
  labelWidth?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 8, bottom: 0, left: horizontal ? 8 : -16 }}
      >
        {horizontal ? (
          <>
            <XAxis type="number" stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey={xKey}
              stroke={CHART.axis}
              fontSize={11}
              width={labelWidth}
              tickLine={false}
              axisLine={false}
            />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke={CHART.axis} fontSize={11} width={40} tickLine={false} axisLine={false} />
          </>
        )}
        <Tooltip
          cursor={{ fill: "rgba(34,211,238,0.06)" }}
          contentStyle={{
            background: "#0c1220",
            border: "1px solid #1e2c45",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "#aab6cc" }}
        />
        <Bar dataKey={dataKey} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} isAnimationActive>
          {data.map((_, i) => (
            <Cell key={i} fill={colorByIndex ? SERIES[i % SERIES.length] : color} />
          ))}
          {showValues && (
            <LabelList
              dataKey={dataKey}
              position={horizontal ? "right" : "top"}
              fontSize={11}
              fill={CHART.axis}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
