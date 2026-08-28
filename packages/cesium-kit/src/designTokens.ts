/**
 * Cesium-facing values for the accepted DESIGN.md and ADR 0024 channel map.
 * CSS/HUD token migration remains tracked separately because canvas colors cannot
 * consume CSS custom properties directly.
 */
export const CESIUM_DESIGN_TOKENS = {
  channels: {
    aviation: '#38bdf8',
    maritime: '#2dd4bf',
    seismic: '#fb923c',
    thermal: '#f43f5e',
    mobility: '#818cf8',
    cctv: '#a855f7',
    radio: '#06b6d4',
    launch: '#facc15',
    weather: '#60a5fa',
    collaborationFallback: '#00f0ff',
  },
  outlines: {
    default: '#030712',
    maritime: '#0f172a',
    seismic: '#451a03',
    thermal: '#881337',
    mobility: '#1e1b4b',
    cctv: '#3b0764',
    radio: '#083344',
    weather: '#1e3a8a',
  },
  effects: {
    launchArc: 'rgba(250, 204, 21, 0.75)',
  },
} as const;
