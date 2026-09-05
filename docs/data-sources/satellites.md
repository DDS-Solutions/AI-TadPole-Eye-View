# Satellites & Orbital Mechanics — Data Source Provenance

**Layer:** Satellites & Orbital Constellations

**Implemented package boundary:** contracts in `packages/contracts/src/satellites.ts`, pure
propagation in `packages/core/src/satellitePropagation.ts`, source adapter in
`packages/providers/src/satellites.ts`, server route in `apps/server/src/routes/satellites.ts`,
and rendering in `packages/cesium-kit/src/satelliteLayer.ts`

**Approved upstream provider:** [CelesTrak standard GP](https://celestrak.org/NORAD/elements/)
**Layer Status:** Implemented with synthetic seed data; production live activation is terms-locked
**Source decision:** [ADR 0034](../adr/0034-celestrak-gp-omm-satellite-source-policy.md)

---

## 1. Provenance & Attribution

- **Selected source:** CelesTrak standard General Perturbations data from the fixed GP query path, requested as JSON using Orbit Mean-Elements Message (OMM) field names.
- **OQ-7:** Resolved by ADR 0034 on 2026-09-04. Direct Space-Track, supplemental GP, historical queries, and TLE-only contracts are outside task 5.2.3.
- **Attribution:** “Orbital elements: CelesTrak; Basic SSA data: U.S. Space Force / 18 SDS via Space-Track.org,” with links to both sources.
- **Redistribution boundary:** GEV may expose derived propagated positions and minimal inspection/provenance fields. It does not provide a raw catalog mirror, passthrough, or download feature.
- **Current repository:** The validated seed-to-server-to-store-to-Cesium path is implemented.
  The browser receives derived positions and provenance, never raw GP/OMM source payloads.

---

## 2. Ingestion & Orbital Mechanics Engine

- **Source contract:** The adapter is limited to server-owned allowlisted `GROUP` queries with
  `FORMAT=JSON`; callers cannot select URLs, groups, formats, or special queries.
- **Catalog bound:** The validated, combined response and rendered layer are capped at 1,000 satellite records.
- **Propagation dependency:** `satellite.js` 7.1.0 (MIT) parses OMM JSON and performs SGP4.
  It has no runtime dependencies. Fixed Vallado case-00005 regression vectors are checked at
  epoch and +360 minutes to 0.0001 km position and 0.000001 km/s velocity precision.
- **Time and frames:** Propagation reads injectable `SimClock`, rejects element offsets beyond
  seven days, and converts SGP4 ECI/TEME estimates to WGS84 geodetic longitude, latitude, and
  altitude. UTC/Julian rollover and invalid-time boundaries are tested.
- **Contract:** Strict Zod boundaries require catalog identity, source group, OMM-derived orbital
  fields, epochs, identifiers, derived-state labels, safety notice, and DataProvenance v1.

---

## 3. Cost Governor & Rate Limits

- **Credentials:** CelesTrak standard GP requires no API key. This does not satisfy or bypass the independent terms and environment gates.
- **Catalog refresh:** Server-only through pinned-fetch, no more than one successful request per allowlisted group every two hours, with one shared single-flight cache.
- **Cache truth:** Fresh TTL is 7,200 seconds. The last valid response may remain visibly stale for at most 86,400 seconds after a failed refresh; it is unavailable after that bound. Redis is not installed, so any production shared-cache deployment remains a separate decision.
- **Propagation window:** Non-synthetic elements are accepted only within seven days of their element epoch. Explicitly synthetic seed elements are exempt so the offline demonstration does not expire; they remain visibly marked synthetic estimates and make no real-world position claim.
- **Budget:** No monetary source charge is currently documented, but the two-hour per-group rate, transport bounds, retry controls, 1,000-record ceiling, governance path, and kill switch are mandatory.
- **Offline / airgap:** Task 5.2.3 may add only a small, time-frozen, GEV-authored synthetic GP/OMM fixture with no copied real catalog, object names, or catalog identifiers.
- **Production lock:** Production remains `TERMS_APPROVAL_REQUIRED` until written commercial-use confirmation or an audited formal acceptance by the designated licensing owner. The GEV platform administrator owns the satellite kill switch.

---

## 4. Honest Data Labeling

- **Rendered label:** Propagated coordinates are mathematical estimates from a named element-set
  epoch and retrieval vintage, never live or authoritative positions.
- **Required warning:** The layer selection card states that estimates are not for navigation,
  conjunction assessment, collision avoidance, maneuver planning, or safety-of-flight use.
- **Access UI:** The registry carries the no-key credential state and production terms lock for
  the planned Settings → Layer Access projection in task 5.3.5. Task 5.2.3 does not create a
  parallel access-state list or falsely present live production access as active.
