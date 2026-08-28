# Satellites & Orbital Mechanics — Data Source Provenance

**Layer:** Satellites & Orbital Constellations

**Planned package boundary:** provider, contract, propagation, server, store, and layer paths are intentionally unassigned until PLAN.md task 5.2.3

**Candidate upstream providers:** [CelesTrak](https://celestrak.org/) · [Space-Track.org](https://www.space-track.org/)
**Layer Status:** Incomplete / unavailable; launch replays are not a satellite catalog

---

## 1. Provenance & Attribution

- **Candidate sources:** Two-Line Element (TLE) and General Perturbations (GP/OMM) orbital element sets from CelesTrak or Space-Track.org.
- **Open decision:** PLAN.md OQ-7 must verify production-source choice, terms, attribution, redistribution allowance, and refresh policy before implementation.
- **Current repository:** No satellite provider, contract, fixture, propagation dependency, server route, store, Cesium layer, or UI wiring is present.

---

## 2. Ingestion & Orbital Mechanics Engine

- **Propagation dependency:** None is installed. Task 5.2.3 must select and review an implementation with deterministic fixture tests and measured bundle/runtime impact.
- **Sim-clock requirement:** Future propagation must evaluate against injectable `SimClock`; it must not call wall-clock APIs directly.
- **Contract requirement:** Future normalized fields and provenance are defined only when the task's Zod boundary lands; this document does not reserve an implemented schema.

---

## 3. Cost Governor & Rate Limits

- **Catalog refresh:** Not implemented. Any live refresh must use pinned-fetch, authentication where required, bounded caching, rate/budget governance, provenance, and a kill switch.
- **Cache truth:** Redis is not installed. A production shared cache is a later deployment decision.
- **Offline / airgap:** No orbital catalog is bundled. A future deterministic fixture requires verified redistribution terms and must be labeled seed data.

---

## 4. Honest Data Labeling

- **Required future label:** Propagated coordinates must be described as mathematical predictions from a named element-set vintage, never live positions.
- **Required future warning:** Staleness/degradation thresholds must be contract-defined and tested before the layer is described as available.
