# ADR 0046: Operational-awareness rendering and architecture baseline

- **Status:** Accepted
- **Date:** 2026-09-05
- **Task:** PLAN.md 5.3.2
- **Extends:** [ADR 0040](./0040-architectural-drift-inventory-and-follow-up-gates.md),
  [ADR 0045](./0045-operational-awareness-source-and-access-policy.md)

## Context

Task 5.3.2 implements the first three sources selected by ADR 0045. Rendering the deterministic
solar boundaries, NWS polygons, and AWC points/polygons requires three cohesive Cesium controller
modules plus controller tests. The architecture inventory therefore reports five additional direct
`cesium` imports. Operational severity and twilight rendering also add six occurrences to the
central Cesium token module, even though every value already belongs to the accepted DESIGN.md
palette.

The drift gate requires a measured ADR review before either fingerprint can become baseline truth.
No dependency declaration, product stack, direct `@cesium/engine` import, large-file exemption, or
wall-clock path changes.

## Decision

- `NwsAlertLayerController`, `AviationWeatherLayerController`, and
  `SolarContextLayerController` own all imperative Cesium entities for these products. Svelte owns
  visibility and validated state only.
- The controllers and their two test modules use the public `cesium` surface. The checked import
  count moves from 20 to 25 while direct `@cesium/engine` imports remain zero.
- Alert severity reuses the accepted governance gold/red pair. Solar boundaries reuse Slate 50,
  Slate 400, Weather Blue, and Indigo Violet from DESIGN.md. The centralized Cesium token count
  moves from 23 to 29; no new palette value or component-local literal is accepted.
- Operational ingestion remains rAF-coalesced. Solar snapshots are additionally limited to one
  accepted SimClock update per second.
- The accepted maximum combined snapshot is 500 alerts plus 400 records for each of METAR, TAF,
  and SIGMET. The dedicated benchmark measured 13.17 ms p95 over 50 warmed update cycles against
  the 16.6 ms budget. The current bundle check remains within its 3,600 KiB gzip total budget.

## Consequences

- The architecture inventory advances to task 5.3.2 with exact, reviewed token and import
  fingerprints.
- Future direct Cesium imports or token changes still fail closed and require their own measured
  review.
- Source validity, AOI, provenance, cache, live-access, and STASIS rules remain governed by ADR
  0045 and the task 5.3.2 contracts; this rendering decision does not broaden provider access.
