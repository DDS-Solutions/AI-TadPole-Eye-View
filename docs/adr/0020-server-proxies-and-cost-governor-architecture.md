# ADR 0020: Server Telemetry Proxies & Cost Governor Architecture

## Status
Accepted (2026-08-26)

## Context
PLAN.md §3 mandates porting all data source proxies out of `vite.config.js` into dedicated Hono server routes with strict governance. Upstream telemetry feeds (OpenSky Network, AISStream, USGS Earthquakes, NASA FIRMS, GBFS Bikeshare) possess distinct polling frequency characteristics, rate limit rules, and cost metrics.

Without server-side caching and cost governance:
1. Rapid client re-renders and multiplayer sessions flood external APIs with redundant requests.
2. 429 rate-limit responses can trigger cascading outages or uncached error loops.
3. Uncontrolled AI agent polling can burn external API credits.

## Decision
1. **Dedicated Hono Route Architecture (`apps/server/src/routes/`)**:
   - `/api/flights`: Aircraft state vectors via `OpenSkyAdapter` (ADS-B).
   - `/api/ships`: Vessel navigation vectors via `AisAdapter` (AIS).
   - `/api/quakes`: Earthquake event GeoJSON features via `UsgsQuakeAdapter`.
   - `/api/firms`: Thermal hotspot anomalies via `FirmsAdapter`.
   - `/api/gbfs`: Bikeshare station occupancy via `GbfsAdapter`.
2. **Cost Governor Middleware (`apps/server/src/middleware/costGovernor.ts`)**:
   - **TTL Tiers**: Enforces per-provider cache lifetimes (flights: 5s, ships: 15s, quakes: 60s, firms: 300s, gbfs: 30s).
   - **Retry-After Cooldown**: When an upstream provider returns 429, the middleware activates cooldown backoff and serves cached payloads with `X-GEV-Cooldown-Active: true`.
   - **Staleness Fallback**: If an upstream provider fails (5xx) or exceeds budget, the middleware serves the most recent cached payload with `X-GEV-Stale: true`.
   - **Budget Enforcement**: Integrates with `CapBudgetGovernor` to prevent overspend.
3. **Deterministic Seed Mode**:
   - Replays recorded fixtures (`fixtures/*.json`) with spatial bounding box filtering in test, development, and offline environments with zero external network access.

## Consequences
- **Positive**: Sub-15ms response latency for cached routes; zero live network dependencies during test and dev; robust rate-limit protection and graceful degradation under upstream failures.
- **Trade-off**: Responses during cooldown are bounded by `maxStaleSeconds`.
