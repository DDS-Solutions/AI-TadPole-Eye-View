# ADR 0047: Coastal and tropical operational-awareness baseline

- **Status:** Accepted
- **Date:** 2026-09-06
- **Task:** PLAN.md 5.3.3
- **Extends:** [ADR 0045](./0045-operational-awareness-source-and-access-policy.md),
  [ADR 0046](./0046-operational-awareness-rendering-and-architecture-baseline.md)

## Context

Task 5.3.3 implements the rank-4 NHC/CPHC and rank-5 NOAA CO-OPS entries selected by ADR
0045. The first-party NHC GIS and CO-OPS API documentation was re-verified on 2026-09-06 with
no material topology, field, or policy conflict. Both sources need strict source-time semantics,
and NHC's optional KMZ form adds archive canonicalization and expansion limits.

Cesium published a vector-tiles technology preview on 2026-09-02 for massive, tiled vector
datasets delivered with 3D Tiles/MVT and Cesium ion. This task's accepted maximum is only 256
advisory products plus 100 coastal stations, and its baseline must remain keyless, seed-capable,
and offline-safe. Preview adoption would introduce a materially different hosting, dependency,
licensing, and rendering boundary.

## Decision

- Only the three fixed NHC basin indexes and same-origin HTTPS GIS KML/KMZ assets are accepted.
  XML is passive; KMZ entries are canonicalized in memory and bounded to 32 entries and 20 MiB
  expanded content. Recursive archives and unsafe paths fail closed.
- Only the fixed CO-OPS metadata/data roots and water-level, tide-prediction, current-observation,
  and current-prediction products are accepted. AOI stations, records, concurrency, hourly
  requests, and response bytes retain the ADR 0045 ceilings.
- Normalized UTC product timestamps coexist with explicit station datum, units, requested time
  zone, and station time-zone name. Observation and prediction collections remain distinct;
  missing/suppressed displayed measurements use an explicit unavailable state, never zero.
- `TropicalCycloneLayerController` and `CoastalConditionsLayerController` own ordinary Cesium
  entities. Refreshes reconcile existing entities through the rAF queue. Vector tiles, Cesium ion
  tiling, and 3D Tiles 2.0 preview formats are outside this baseline.
- The two controller modules add two direct public `cesium` imports. The measured import count
  moves from 25 to 27; direct `@cesium/engine` imports remain zero. Existing DESIGN.md tokens are
  reused without a token or color-fingerprint change.
- Final canonical parser replay measured NHC's 256-item index at 4.54 ms p95 and CO-OPS at 100
  stations/10,000 records at 31.36 ms p95, both below 50 ms. The combined 2,056-entity operational
  snapshot measured 12.46 ms p95 against the 16.6 ms Cesium ingestion budget.

## Consequences

- The architecture inventory advances to task 5.3.3 and ADR 0047 with 27 direct `cesium`
  imports and no new stack package, large-file exception, color value, or wall-clock path.
- Live activation remains independently gated by explicit access, recorded source terms, and the
  required public identifier. Seed/test/CI remain network-free.
- A future vector-tiles evaluation requires its own ADR and performance spike demonstrating a
  scale need, offline/seed behavior, source licensing, hosting costs, and migration path.
