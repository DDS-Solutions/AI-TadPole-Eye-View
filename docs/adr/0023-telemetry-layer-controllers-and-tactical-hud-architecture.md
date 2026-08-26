# ADR 0023: Telemetry Layer Controllers & Tactical HUD Architecture

## Status
Accepted (2026-08-26)

## Context
PLAN.md §8 (Feature Roadmap) and §10 (Phase 2 Item 1) specify implementing rendering, filtering, and HUD control for Telemetry Layers 2–5:
1. **Marine AIS (Layer 2)**: Emerald Teal (`#2dd4bf`) vessel points, speed/heading vectors, and vessel metadata inspection.
2. **USGS Earthquakes (Layer 3)**: Amber Orange (`#fb923c`) magnitude-scaled hypocenters with M2.5+ and M4.5+ magnitude filters.
3. **NASA FIRMS Thermal Hotspots (Layer 4)**: Rose Red (`#f43f5e`) thermal hotspot cluster billboards with Fire Radiative Power (FRP) and confidence filters.
4. **GBFS Bikeshare Transit (Layer 5)**: Indigo Violet (`#818cf8`) station capacity visualizer with bike/dock availability filters.
5. **Tactical Industrial HUD Controls**: Svelte 5 rune-based layer toggle switches, filter panels, entity inspection cards, and telemetry channel badges adhering strictly to [DESIGN.md](../DESIGN.md).

## Decision
1. **Decoupled Cesium Layer Controllers (`packages/cesium-kit`)**:
   - `MarineLayerController`: Ingests `ShipBatch` arrays, renders Emerald Teal vessel primitives, filters by vessel type (`cargo`, `tanker`, `passenger`, `fishing`), and manages visibility.
   - `QuakeLayerController`: Ingests `EarthquakeCollection`, scales primitives by Richter magnitude, filters by minimum magnitude, and manages visibility.
   - `FirmsLayerController`: Ingests `ThermalHotspotBatch`, scales primitives by FRP (MW), filters by FRP and confidence level (`nominal`, `high`), and manages visibility.
   - `GbfsLayerController`: Ingests `BikeStationBatch`, scales primitives by station capacity and bike availability, filters by minimum available bikes, and manages visibility.
   - All layer controllers drain incoming updates through a `requestAnimationFrame` queue directly into Cesium `CustomDataSource` collections, ensuring 60 FPS globe rendering without triggering Svelte reactivity cycles.
2. **Globe Entity Picking & Selection (`GlobeController`)**:
   - Installed `ScreenSpaceEventHandler` on Cesium canvas to capture left-click entity picks across all active telemetry layers and emit structured properties to the reactive Svelte store.
3. **Multi-Layer Debug Bus (`attachDebugBus`)**:
   - Expanded `GevDebugBus` to report live entity tallies per layer (`getLayerCounts`), entity IDs (`getShipIds`, `getQuakeIds`, `getHotspotIds`, `getStationIds`), and selected entity state for Playwright condition-wait testing.
4. **Tactical HUD & Svelte 5 Stores (`apps/web`)**:
   - `stores/layers.svelte.ts`: Manages layer visibility, filter criteria, active entity counts, and selected entity inspection state using Svelte 5 runes (`$state`, `$derived`).
   - `components/HudHeader.svelte`: Renders title, live status, sim/wall clock, and strict telemetry channel badges.
   - `components/LayerControlPanel.svelte`: Floating industrial HUD (`bg-panel-glass`, `border-panel`) with toggle switches, filter chips, and seed-mode status badge.
   - `components/EntityInfoCard.svelte`: Floating inspector card displaying monospace telemetry (`font-mono`, `tabular-nums`) with channel color borders.

## Consequences
- **Positive**: Full multi-layer geospatial visualization operating entirely in keyless seed mode; strict adherence to [DESIGN.md](../DESIGN.md) telemetry channel color laws; clean separation between Cesium imperative graphics and Svelte 5 reactive HUD overlays.
- **Phase 2 Progress**: Phase 2 Item 1 (Layers 2–5) is complete and verified with automated unit and Playwright E2E smoke tests.
