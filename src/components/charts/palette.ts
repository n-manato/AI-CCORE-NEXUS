// Shared chart palette aligned with the dark theme tokens.
export const CHART = {
  accent: "#22d3ee",
  soft: "#38bdf8",
  ok: "#34d399",
  warn: "#f59e0b",
  danger: "#f43f5e",
  violet: "#a78bfa",
  pink: "#f472b6",
  grid: "#1e2c45",
  axis: "#7e8aa3",
};

// Ordered series of distinct hues for multi-category charts.
export const SERIES = [
  CHART.accent,
  CHART.violet,
  CHART.ok,
  CHART.warn,
  CHART.pink,
  CHART.soft,
  CHART.danger,
];

// Picks a usage color by fraction (0-1): green -> amber -> red.
export function usageColor(fraction: number): string {
  if (fraction >= 0.95) return CHART.danger;
  if (fraction >= 0.85) return CHART.warn;
  if (fraction >= 0.7) return CHART.warn;
  return CHART.ok;
}
