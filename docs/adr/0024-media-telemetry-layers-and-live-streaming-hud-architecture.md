# 0024. Media Telemetry Layers, Orbital Trajectories & Live Streaming HUD Architecture

Date: 2026-08-26
Status: Accepted

## Context

Phase 2 of [PLAN.md](../../PLAN.md) §8 and §10 specifies delivering Layers 6–9:
- **Layer 6: Public CCTV Cameras** — Verified DOT traffic and weather camera positions with live snapshot previews and video streaming proxies.
- **Layer 7: Global Radio Stations & ATC Frequencies** — Aviation ATC towers, marine distress VHF channels, and broadcast streams.
- **Layer 8: Space Launch Replays & Trajectories** — Multi-stage orbital rocket trajectories with altitude coordinates and `[SIMULATED]` provenance badges.
- **Layer 9: Weather / Radar Overlays** — RainViewer precipitation radar raster tiles and meteorological surface stations.

These layers require rich media delivery (audio streams, dynamic image refreshes, orbital polyline arcs) that must maintain 60 FPS globe rendering, enforce ethical boundaries (no facial recognition or plate scanning), and preserve keyless zero-quota operation in seed mode.

## Decision

1. **Strict Channel Color Laws ([DESIGN.md](../DESIGN.md))**:
   - **Public CCTV Cameras (Layer 6)**: Purple/Violet (`#a855f7`) markers and badges.
   - **Radio & ATC Frequencies (Layer 7)**: Cyan/Lime (`#06b6d4`) towers and audio visualizers.
   - **Space Launches (Layer 8)**: Gold/Yellow (`#facc15`) polyline ascent arcs with stage separation points.
   - **Weather & Radar (Layer 9)**: Sky Blue (`#60a5fa`) meteorological points and precipitation overlays.

2. **Ethical CCTV & Radio Sandboxing**:
   - Only public traffic/weather cameras from verified DOT agencies are proxied (`/api/cctv/snapshot/:id`).
   - Radio streams route through allowlisted server proxies with TLS verification and 30-second timeout lifecycles (`/api/radio/stream/:id`).

3. **Modeled Trajectory Provenance**:
   - Orbital launch trajectories carry explicit `is_simulated` boolean flags displayed on the HUD inspector as `[SIMULATED ORBITAL MODEL]` or `[RECONSTRUCTED TELEMETRY]`.

4. **rAF Batch Ingestion in `@gev/cesium-kit`**:
   - `CctvLayerController`, `RadioLayerController`, `LaunchLayerController`, and `WeatherLayerController` drain batches through `requestAnimationFrame` using `entities.suspendEvents()` / `entities.resumeEvents()`.

5. **Integrated Live Media HUD**:
   - Tactical inspector `EntityInfoCard.svelte` provides live CCTV image refreshes and native HTML5 `<audio>` playback with Svelte 5 reactive bindings.

## Consequences

- **Pros**:
  - Full 9-layer situational awareness active simultaneously in the tactical console.
  - Zero live API quota burn in default seed mode.
  - Ethical and licensing boundaries preserved.
- **Cons**:
  - Requires server proxy routing for external media to prevent CORS errors on client browsers.
