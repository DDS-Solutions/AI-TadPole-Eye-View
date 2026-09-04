# Satellites & Orbital Mechanics — Data Source Provenance

**Layer:** Satellites & Orbital Constellations

**Planned package boundary:** provider, contract, propagation, server, store, and layer paths are intentionally unassigned until PLAN.md task 5.2.3

**Approved upstream provider:** [CelesTrak standard GP](https://celestrak.org/NORAD/elements/)
**Layer Status:** Planned / unavailable pending task 5.2.3; production activation is terms-locked
**Source decision:** [ADR 0034](../adr/0034-celestrak-gp-omm-satellite-source-policy.md)

---

## 1. Provenance & Attribution

- **Selected source:** CelesTrak standard General Perturbations data from the fixed GP query path, requested as JSON using Orbit Mean-Elements Message (OMM) field names.
- **OQ-7:** Resolved by ADR 0034 on 2026-09-04. Direct Space-Track, supplemental GP, historical queries, and TLE-only contracts are outside task 5.2.3.
- **Attribution:** “Orbital elements: CelesTrak; Basic SSA data: U.S. Space Force / 18 SDS via Space-Track.org,” with links to both sources.
- **Redistribution boundary:** GEV may expose derived propagated positions and minimal inspection/provenance fields. It does not provide a raw catalog mirror, passthrough, or download feature.
- **Current repository:** No satellite provider, contract, fixture, propagation dependency, server route, store, Cesium layer, or UI wiring is present.

---

## 2. Ingestion & Orbital Mechanics Engine

- **Source contract:** The future adapter is limited to server-owned allowlisted `GROUP` queries with `FORMAT=JSON`; callers cannot select URLs, groups, formats, or special queries.
- **Catalog bound:** The validated, combined response and rendered layer are capped at 1,000 satellite records.
- **Propagation dependency:** None is installed. Task 5.2.3 must select and review an implementation with deterministic fixture tests, accepted SGP4 vectors/tolerances, and measured bundle/runtime impact.
- **Sim-clock requirement:** Future propagation must evaluate against injectable `SimClock`; it must not call wall-clock APIs directly.
- **Contract requirement:** Future normalized fields and provenance are defined only when the task's Zod boundary lands; this document does not reserve an implemented schema.

---

## 3. Cost Governor & Rate Limits

- **Credentials:** CelesTrak standard GP requires no API key. This does not satisfy or bypass the independent terms and environment gates.
- **Catalog refresh:** Server-only through pinned-fetch, no more than one successful request per allowlisted group every two hours, with one shared single-flight cache.
- **Cache truth:** Fresh TTL is 7,200 seconds. The last valid response may remain visibly stale for at most 86,400 seconds after a failed refresh; it is unavailable after that bound. Redis is not installed, so any production shared-cache deployment remains a separate decision.
- **Budget:** No monetary source charge is currently documented, but the two-hour per-group rate, transport bounds, retry controls, 1,000-record ceiling, governance path, and kill switch are mandatory.
- **Offline / airgap:** Task 5.2.3 may add only a small, time-frozen, GEV-authored synthetic GP/OMM fixture with no copied real catalog, object names, or catalog identifiers.
- **Production lock:** Production remains `TERMS_APPROVAL_REQUIRED` until written commercial-use confirmation or an audited formal acceptance by the designated licensing owner. The GEV platform administrator owns the satellite kill switch.

---

## 4. Honest Data Labeling

- **Required future label:** Propagated coordinates are mathematical estimates from a named element-set epoch and retrieval vintage, never live or authoritative positions.
- **Required warning:** Not for navigation, conjunction assessment, collision avoidance, maneuver planning, or other safety-of-flight use.
- **Access UI:** The unavailable layer remains visible and gray, states that no API key is required, explains the licensing lock, and links to the source documentation and approval instructions.
