// Recharts accepts CSS variables, so charts follow the light/dark theme tokens.
export const chartColors = {
  primary: "var(--color-chart-1)",
  success: "var(--color-chart-2)",
  warning: "var(--color-chart-3)",
  violet: "var(--color-chart-4)",
  danger: "var(--color-chart-5)",
};

export const chartGridProps = { strokeDasharray: "3 3", stroke: "var(--color-border)" };

export const chartAxisProps = {
  stroke: "var(--color-border-strong)",
  fontSize: 12,
  tickLine: false,
  tick: { fill: "var(--color-muted-foreground)" },
};

export const chartTooltipProps = {
  cursor: { fill: "var(--color-muted)", opacity: 0.6 },
  contentStyle: {
    backgroundColor: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    boxShadow: "var(--shadow-lg)",
    color: "var(--color-popover-foreground)",
    fontSize: 12,
    padding: "8px 10px",
  },
  labelStyle: { color: "var(--color-muted-foreground)", marginBottom: 4 },
  itemStyle: { color: "var(--color-popover-foreground)", padding: 0 },
};

export const chartLegendProps = {
  iconType: "circle" as const,
  iconSize: 8,
  wrapperStyle: { fontSize: 12, color: "var(--color-muted-foreground)" },
};
