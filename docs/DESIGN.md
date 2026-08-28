# DESIGN.md — UI, HUD & Visual Design System

**Audience:** Frontend engineers and AI agents implementing UI components, HUD overlays, telemetry visualizers, and themes in GEV v2 (`apps/web`, `packages/cesium-kit`).
**Source of truth:** [PLAN.md](../PLAN.md) §3.3.

---

## 1. Design Philosophy: Industrial OSINT & Tactical Command Console

GEV v2 is a high-density, real-time geospatial intelligence console. The visual language balances maximum information density with minimal cognitive friction:

- **Globe as Primary Surface**: The 3D globe (CesiumJS) is the primary viewport. UI components float as glassmorphic HUD overlays above the canvas.
- **Strict Pointer Pass-Through**: Container overlays must specify `pointer-events: none`, while interactive cards, toolbars, and inputs specify `pointer-events: auto`.
- **Zero Layout Shift / Monospace Precision**: Dynamic telemetry values, coordinates, timestamps, and squawk codes must use fixed-width monospace typography (the current semantic `.mono` class, `JetBrains Mono`, or `ui-monospace`). Tailwind utility names are not an installed styling surface.
- **Decoupled 60 FPS Rendering**: UI state is reactive via Svelte 5 runes (`$state`, `$derived`). Per-frame Cesium rendering passes through the imperative rAF queue in `packages/cesium-kit`, preventing HUD rerenders from degrading globe performance.

---

## 2. Color System & Design Tokens

### 2.1 Core Neutral Palette

| Token | Class / Value | Hex | Description |
|---|---|---|---|
| **Base Surface** | `bg-surface-void` | `#030712` | Deep obsidian background behind the WebGL canvas |
| **Glass Panel** | `bg-panel-glass` | `rgba(15, 23, 42, 0.85)` | Blur card background (`backdrop-filter: blur(12px)`) |
| **Glass Border** | `border-panel` | `rgba(148, 163, 184, 0.18)` | Subtle translucent slate border |
| **Text Primary** | `text-primary` | `#f8fafc` (Slate 50) | High-contrast titles, metrics, coordinates |
| **Text Muted** | `text-muted` | `#94a3b8` (Slate 400) | Secondary labels, units, and timestamps |
| **Accent Glow** | `glow-cyan` | `0 0 12px rgba(56, 189, 248, 0.35)` | Focus and active selection ring |

### 2.2 Telemetry Channel Color Laws

Every telemetry domain is strictly mapped to a dedicated color channel across globe billboards, 2D icons, HUD badges, and list items. **AI agents must never alter these channel assignments:**

| Channel | Hex Token | Accent Name | Description |
|---|---|---|---|
| **Aviation (ADS-B)** | `#38bdf8` | `Sky Cyan` | Aircraft vectors, altitude tracks, callsigns |
| **Maritime (AIS)** | `#2dd4bf` | `Emerald Teal` | Vessels, cargo, tankers, course-over-ground |
| **Seismic (USGS)** | `#fb923c` | `Amber Orange` | Earthquakes, magnitude rings, hypocentral depth |
| **Thermal (FIRMS)** | `#f43f5e` | `Rose Red` | NASA thermal hotspots, wildfire FRP points |
| **Urban Mobility (GBFS)** | `#818cf8` | `Indigo Violet` | Bikeshare docks, capacity gauges |
| **Governance / STASIS** | `#eab308` / `#ef4444` | `Gold / Red` | Budget burn meter, approval prompts, STASIS lockdown |

---

## 3. Typography Hierarchy

- **UI Headings**: Sans-serif (`Inter`, `system-ui`, `-apple-system`), semi-bold (600), tracking tight (`tracking-tight`).
- **Telemetry Values**: Monospace (`JetBrains Mono`, `ui-monospace`, `monospace`), tabular numbers (`tabular-nums`), font-medium (500).
- **Attributions & Legal**: Sans-serif 11px (`text-xs`), muted (`text-slate-400`).

---

## 4. Installed and proposed component architecture ([PLAN.md §3.3](../PLAN.md))

Package manifests are the installed source of truth:

1. **Primitives**: Current controls are native Svelte components with component-scoped CSS. `shadcn-svelte` and `bits-ui` are not installed; adopting either requires the normal dependency and accessibility review.
2. **Docking Panes**: `paneforge` is not installed. The current HUD uses fixed overlays; resizable panes remain proposed work.
3. **High-Density Lists**: `@tanstack/svelte-virtual` is installed, but the current `VirtualizedTelemetryTable.svelte` uses its own bounded window calculation and does not import that package. Do not attribute the implementation to TanStack until a measured migration lands.
4. **Time-Series Charts**: `uPlot` is installed and used by `TelemetryTimelineChart.svelte` for Canvas rendering.
5. **Toasts & Alerts**: `svelte-sonner` is not installed. Current alerts are local component state; a toast dependency requires review before adoption.

---

## 5. Review Anti-Patterns (Instant PR Rejection)

- Adding arbitrary or clashy colors outside the telemetry channel map.
- Placing opaque solid backgrounds over the globe where glassmorphism is specified.
- Mutating Cesium camera or primitives directly from Svelte component script tags instead of `packages/cesium-kit`.
- Omitting required OpenStreetMap attribution (`footer.attribution-badge`).
