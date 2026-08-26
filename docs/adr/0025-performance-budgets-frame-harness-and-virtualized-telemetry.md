# 0025. Performance Budgets, Frame-Time Harness & Virtualized Telemetry Architecture

Date: 2026-08-26
Status: Accepted

## Context

Phase 2 of [PLAN.md](../../PLAN.md) §10 and §13 mandates:
1. **Performance budgets enforced in CI** with deterministic bundle size validation for `@gev/web`.
2. **Frame-time benchmark harness** ensuring render loop latency `< 16.6ms p95` for 60 FPS target under multi-layer load.
3. **PWA shell architecture** providing standalone execution, asset caching, and offline resilience.
4. **High-density virtualized telemetry list** capable of scrolling thousands of active entities at 60 FPS without DOM bloat.
5. **Time-series elevation/velocity charts** using canvas-based `uPlot` with sub-millisecond redraw latency.

## Decision

1. **Cesium Frame-Time Benchmark Harness (`packages/cesium-kit`)**:
   - Implemented `FrameBudgetMonitor` in [`packages/cesium-kit/src/frameBudget.ts`](../../packages/cesium-kit/src/frameBudget.ts) capturing rolling frame deltas, instantaneous/average FPS, percentiles (p50, p95, p99), and budget breaches (>16.66ms).
   - Attached to Cesium's `scene.postRender` event and exposed to operator tooling via `window.__gev.getFrameReport()` and `window.__gev.getFrameMetrics()`.
   - Verified through automated Vitest benchmarks ingesting 1,000+ simultaneous entities across all 9 telemetry layers in `< 16.6ms p95`.

2. **Deterministic Bundle Budgets & Rollup Chunking**:
   - Configured Vite Rollup `manualChunks` in [`apps/web/vite.config.ts`](../../apps/web/vite.config.ts) to isolate `@cesium/engine`, `svelte`, `uplot`, and `@tanstack/svelte-virtual` into independent vendor chunks.
   - Built [`scripts/check-bundle-budgets.mjs`](../../scripts/check-bundle-budgets.mjs) automated validator checking uncompressed and gzip compressed chunk limits (Entry JS <= 150KB, Vendor Cesium <= 3.2MB, CSS <= 50KB, Total JS <= 3.6MB) as an automated CI gate (`pnpm check:budgets`).

3. **High-Density Virtualized Telemetry Table (`apps/web`)**:
   - Implemented [`apps/web/src/components/VirtualizedTelemetryTable.svelte`](../../apps/web/src/components/VirtualizedTelemetryTable.svelte) using windowed virtualization.
   - Constrains DOM elements to active viewport rows (~15–30 nodes out of 1,000+ active items), maintaining smooth 60 FPS scrolling.
   - Features real-time multi-field search, channel filter chips (ADS-B, AIS, USGS, FIRMS, GBFS, CCTV, RADIO, LAUNCH, WX), and one-click camera focus on Cesium entities.

4. **Canvas-Based Time-Series Telemetry (uPlot)**:
   - Implemented [`apps/web/src/components/TelemetryTimelineChart.svelte`](../../apps/web/src/components/TelemetryTimelineChart.svelte) using `uPlot` on Canvas.
   - Provides sub-millisecond redraw latency and tactical dark styling matching [DESIGN.md](../DESIGN.md).
   - Embedded directly into [`apps/web/src/components/EntityInfoCard.svelte`](../../apps/web/src/components/EntityInfoCard.svelte) for aircraft altitude/velocity curves, rocket ascent trajectories, and weather atmospheric histories.

5. **PWA Shell & Offline Baseline**:
   - Added [`apps/web/public/manifest.webmanifest`](../../apps/web/public/manifest.webmanifest) and [`apps/web/public/sw.js`](../../apps/web/public/sw.js) for standalone application shell caching while letting live telemetry proxies bypass the cache.

## Consequences

- **Pros**:
  - Deterministic CI performance enforcement protects against bundle size regressions.
  - Frame budget monitor gives quantitative proof of 60 FPS rendering under heavy entity loads.
  - Virtualized lists eliminate DOM memory leaks and layout thrashing.
  - uPlot canvas charts provide instantaneous telemetry inspection with zero UI latency.
- **Cons**:
  - Requires build artifacts to be generated before running bundle budget assertions.
