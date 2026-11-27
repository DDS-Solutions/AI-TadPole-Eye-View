/** Canvas/chart values matching DESIGN.md and ADR 0024 channel assignments. */
export const WEB_CHANNEL_COLORS = {
  flight: '#38bdf8',
  marine: '#2dd4bf',
  quake: '#fb923c',
  firms: '#f43f5e',
  gbfs: '#818cf8',
  cctv: '#a855f7',
  radio: '#06b6d4',
  launch: '#facc15',
  weather: '#60a5fa',
  cable: '#f472b6',
  satellite: '#c084fc',
  muted: '#94a3b8',
} as const;

/** Canvas/uPlot values matching hudTokens.css and DESIGN.md telemetry chart tokens. */
export const WEB_CHART_THEME = {
  cursor: '#38bdf8',
  axis: '#94a3b8',
  grid: 'rgba(148, 163, 184, 0.12)',
  ticks: 'rgba(148, 163, 184, 0.25)',
} as const;
