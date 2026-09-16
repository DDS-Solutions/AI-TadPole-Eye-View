# ADR 0051: Lazy Intelligence Route and Cesium Bundle Decoupling Architecture

- **Status:** Accepted
- **Date:** 2026-09-15
- **Task:** PLAN.md 7.3
- **Extends:** ADR 0014, ADR 0019, ADR 0023, ADR 0025, ADR 0031

## Context

GEV v2 was originally structured as a monolithic single-page Tactical Geospatial OSINT console where `App.svelte` statically imported `GlobeController`, telemetry layer controllers from `@gev/cesium-kit`, and Cesium. This caused Cesium (a 1.16 MB gzip vendor bundle with multi-megabyte WebGL worker assets) to be included in the primary application entry dependency graph.

Task 7.3 requires adding a lazy-loaded `/#/intelligence` route and navigation in `apps/web` for future Economic Intelligence surfaces (Phases 8–11) without importing, downloading, or initializing Cesium on the intelligence route. The task establishes a strict performance budget: the initial bundle size delta must not exceed 15 KB gzip, the lazy route chunk must load only on navigation, Cesium must not be downloaded or initialized on `/#/intelligence`, and all existing quality gates must remain green.

## Decision

### 1. Hash-based routing without third-party dependencies

Rather than adding an external router package that would increase bundle size and introduce third-party maintenance risk, `apps/web` adopts a native Svelte 5 hash router shell in `App.svelte`:
- `/#/` (or default `""` / `#/globe`): Tactical Globe console (`GlobeRoute.svelte`).
- `/#/intelligence`: Economic Intelligence surface (`IntelligenceRoute.svelte`).

The router uses Svelte 5 runes (`$state`, `$effect`, `onMount`) to reactively track `window.location.hash` and dispatch dynamic `import()` calls only when the respective route becomes active.

### 2. Complete Cesium decoupling and dynamic code-splitting

- The Cesium globe container, all 16 telemetry layer controllers, `FrameBudgetMonitor`, and `attachDebugBus` are extracted into `apps/web/src/routes/GlobeRoute.svelte`.
- `App.svelte` maintains zero static imports of Cesium, `@cesium/engine`, or `@gev/cesium-kit`.
- Vite's Rollup manual chunk configuration groups `@gev/cesium-kit` alongside `@cesium/engine` and `cesium` into the `vendor-cesium` chunk.
- When navigating directly to `http://localhost:5180/#/intelligence`:
  - The browser requests only the minimal app entry (`index-....js`, ~1.93 KB gzip) and the lazy route chunk (`IntelligenceRoute-....js`, ~2.85 KB gzip + ~1.63 KB CSS).
  - Neither `GlobeRoute-....js` nor `vendor-cesium-....js` is fetched or referenced in the modulepreload list.
  - Cesium is not downloaded, no WebGL contexts are created, and `window.__gev` remains uninitialized.

### 3. Navigation and design token compliance

- Both views provide glassmorphic pill navigation controls (`#nav-link-globe`, `#nav-link-intelligence`) styled strictly according to `docs/DESIGN.md`:
  - Neutral dark surface void background (`#030712`, `var(--hud-surface-dark)`).
  - Glassmorphic panels (`rgba(15, 23, 42, 0.85)`, `var(--hud-panel-bg)`, `backdrop-filter: blur(12px)`, `border: 1px solid var(--hud-border)`).
  - High-contrast text (`#f8fafc`, `var(--hud-text-primary)`) and muted text (`#94a3b8`, `var(--hud-text-secondary)`).
  - Active route tab highlighted with cyan glow (`var(--hud-accent-selected)`, `border-color: var(--hud-accent-border)`).
  - Monospace font stack (`JetBrains Mono`, `ui-monospace`, `monospace`) for metrics and codes.
- The Intelligence route presents the roadmap for Economic R0–R3 (Phases 8–11) with explicit status badges (`PLANNED` per DESIGN.md §5.1) and runtime decoupling telemetry.

### 4. Performance budget enforcement

`scripts/check-bundle-budgets.mjs` is updated with dedicated budget categories:
- `Lazy Intelligence Route` chunk budget: 25 KB gzip (measured: 2.85 KB gzip JS + 1.63 KB CSS = 4.48 KB gzip total delta, well below the 15 KB threshold).
- `Globe Route Chunk` budget: 100 KB gzip (measured: 31.33 KB gzip).
- `App Entry JS` chunk budget: 150 KB gzip (measured: 1.93 KB gzip, a >98% reduction from the previous monolithic entry).

## Consequences

- Direct navigation to `/#/intelligence` is lightweight, fast, and completely free of WebGL overhead.
- Switching to `#/` seamlessly streams `vendor-cesium` and `GlobeRoute`, mounting the full 3D tactical globe.
- Returning to `/#/intelligence` cleanly unmounts Cesium and aborts telemetry polling without memory leaks.
- The codebase introduces zero new npm dependencies.
