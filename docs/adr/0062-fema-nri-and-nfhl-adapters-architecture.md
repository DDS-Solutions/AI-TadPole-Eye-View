# ADR 0062 — FEMA NRI and NFHL natural hazard and flood risk adapters, variable dictionary, non-coercion, and screening disclaimers

**Status:** Accepted  
**Date:** 2026-09-26  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.2, §11.1, AGENTS.md, ADR 0035, ADR 0050, ADR 0052, ADR 0060  

---

## 1. Context

In PLAN.md §10 Task 11.1, Phase 11 (Economic R3: Risk, Resilience, and Accessibility) requires ingestion, boundary contracts, pure domain variable dictionaries, non-coercion invariants, advisory disclaimers, and provider adapters for two authoritative Federal Emergency Management Agency (FEMA) programs:
1. **National Risk Index (NRI)**: Multi-hazard composite scores, Expected Annual Loss (EAL), Social Vulnerability (SoVI via CDC SVI), Community Resilience (BRIC), and 18 natural hazard risk ratings at county and tract geographic levels.
2. **National Flood Hazard Layer (NFHL)**: Digital Flood Insurance Rate Map (DFIRM) databases, Base Flood Elevations (BFEs), vertical datums, and regulatory flood hazard zones (Special Flood Hazard Areas / SFHA 100-year, 500-year moderate, Zone X minimal, and undetermined Zone D).

Specific requirements from PLAN.md §11.1 and the authorized 4-Pillar brief:
1. Versioned contracts for FEMA NRI (18 hazard types, composite scores, ratings, EAL totals) and FEMA NFHL (zones A, AE, AH, AO, AR, A99, V, VE, X, D, floodway subtypes, BFEs, vertical datums);
2. Strict non-coercion laws:
   - Undetermined flood hazard (Zone D) must never be coerced to minimal risk or treated as non-hazardous;
   - Missing or unstudied Base Flood Elevations must never be coerced to 0.0 elevation;
   - Inland geographies where coastal hazards (e.g. tsunami, coastal flooding) are not modeled must evaluate as `not_applicable`, not zero risk;
3. Mandatory statutory and advisory screening disclaimers:
   - `FEMA_NRI_SCREENING_DISCLAIMER`: clarifies that NRI scores are designed for preliminary planning, hazard mitigation, and community screening, and do not replace site-specific geotechnical, structural, or hydrological studies;
   - `FEMA_NFHL_ADVISORY_DISCLAIMER`: clarifies that NFHL data provide advisory flood hazard screening and do not constitute a formal Letter of Map Amendment (LOMA), Letter of Map Revision (LOMR), or elevation certificate;
4. Kill switches (`GEV_FEMA_NRI_ENABLED`, `GEV_FEMA_NFHL_ENABLED`) failing closed;
5. Strict seed mode enforcement: zero live network calls without explicit developer authorization under `GEV_SEED_MODE=1`;
6. Performance threshold: query and summary latency < 25ms p95 (achieved < 0.1ms p95 via in-memory indexing).

---

## 2. Decision

### 2.1 Contracts Layer (`packages/contracts/src/fema.ts`)
- **FEMA NRI**:
  - `FemaNriHazardTypeSchema`: 18 natural hazards (`riverine_flooding`, `coastal_flooding`, `hurricane`, `tornado`, `wildfire`, `earthquake`, `strong_wind`, `heat_wave`, `drought`, `winter_weather`, `hail`, `ice_storm`, `landslide`, `lightning`, `tsunami`, `avalanche`, `cold_wave`, `volcanic_activity`);
  - `FemaNriRiskRatingSchema`: 5 qualitative tiers (`Very Low`, `Relatively Low`, `Relatively Moderate`, `Relatively High`, `Very High`);
  - `FemaNriVariableIdSchema`: authoritative literals (`RISK_SCORE`, `RISK_RATNG`, `EAL_VALT`, `SOVI_SCORE`, `RESL_SCORE`, and hazard-specific score/rating/EAL triplets);
  - `FemaNriUnitSchema`: `index_score`, `USD`, `categorical_rating`, `count`, `ratio`, `percentile`;
  - `FemaNriVariableDefinitionSchema` & `FemaNriVariableDictionarySchema`;
  - `FemaNriQuerySchema`: validates allowed geographies (`county`, `tract`, `state`) and variable filters;
  - `FEMA_NRI_SCREENING_DISCLAIMER`: mandatory screening notice attached to query outputs.
- **FEMA NFHL**:
  - `FemaNfhlFloodZoneSchema`: regulatory flood zones (`A`, `AE`, `AH`, `AO`, `AR`, `A99`, `V`, `VE`, `X`, `D`);
  - `FemaNfhlRiskCategorySchema`: `high_risk_sfha`, `moderate_risk_500yr`, `minimal_risk_outside_sfha`, `undetermined_risk_zone_d`, `unknown`;
  - `FemaNfhlBoundingBoxSchema`: strict 4-tuple `[minLon, minLat, maxLon, maxLat]`;
  - `FemaNfhlFloodHazardFeatureSchema`: DFIRM attributes with `static_bfe` and `depth` modeled as `EconomicEstimate` discriminated unions;
  - `FemaNfhlSummarySchema`: composite location summary preserving dominant zone, SFHA presence, floodway flag, and highest BFE;
  - `FEMA_NFHL_ADVISORY_DISCLAIMER`: mandatory advisory notice attached to all flood summaries.

### 2.2 Pure Domain Layer (`packages/economic/src/femaNriVariables.ts`, `packages/economic/src/femaDictionary.ts`)
To comply with the strict 500-line limit (Rule 15), domain logic was split cleanly into two focused modules:
1. `femaNriVariables.ts` (399 lines): pure definitions of `FEMA_NRI_VARIABLES_V1`, variable lookup helper `lookupFemaNriVariable`, and authoritative dictionary instance `FEMA_NRI_VARIABLE_DICTIONARY_V1`;
2. `femaDictionary.ts` (246 lines): pure transformation functions and parsers:
   - `validateFemaNriGeography`: verifies county, tract, or state level;
   - `classifyNfhlFloodRisk`: maps flood zone and subtype to `FemaNfhlRiskCategory`, strictly isolating Zone D as `undetermined_risk_zone_d`;
   - `parseNriRiskRating`: parses qualitative strings into `FemaNriRiskRating` with non-coercion for unrated;
   - `parseNriRawEstimate`: maps raw numbers and sentinel codes to `EconomicEstimate`;
   - `parseNfhlStaticBfe` & `parseNfhlDepth`: parses DFIRM elevations, mapping sentinel codes (`-9999`, null, undefined) to `{ status: 'not_applicable' }`;
   - `parseFemaNfhlFeaturesFixture`: validates raw NFHL GeoJSON/ArcGIS features datasets.

### 2.3 Synthetic Seed Fixtures (`fixtures/`)
- `fixtures/fema-nri-synthetic-v1.json`: enriched with composite risk scores, EAL totals, SoVI, BRIC, riverine flooding, wildfire, earthquake, and not-applicable inland tsunami ratings across Travis County (`48453`) and Census Tract `48453000101`;
- `fixtures/fema-nfhl-synthetic-v1.json`: evidence records representing flood insurance rate map determinations;
- `fixtures/fema-nfhl-features-synthetic-v1.json`: raw NFHL features containing Austin Lady Bird Lake Zone AE with BFE 432.0 NAVD88, Shoal Creek 500-year Zone X, minimal Zone X, and unstudied Zone D in Western Travis County.

### 2.4 Provider Adapters (`packages/providers/src/femaNri.ts`, `packages/providers/src/femaNfhl.ts`)
- **`FemaNriAdapter`**:
  - Seed mode loads `fema-nri-synthetic-v1.json` with zero live network calls;
  - Geography index by county and tract;
  - Convenience queries: `getCompositeRisk`, `getExpectedAnnualLoss`, `getSocialVulnerability`, `getCommunityResilience`, `getHazardRisk`;
  - Kill-switch via `GEV_FEMA_NRI_ENABLED` throwing `FemaNriProviderDisabledError`;
  - Rejection of live requests under seed mode throwing `FemaNriSeedModeViolationError`.
- **`FemaNfhlAdapter`**:
  - Seed mode loads `fema-nfhl-features-synthetic-v1.json`;
  - Spatial point-in-bounding-box and bounding-box-intersection queries;
  - `getFloodSummary`: aggregates intersecting features into a high-level flood hazard determination prioritizing SFHA > 500-yr > Zone D > minimal, strictly attaching `FEMA_NFHL_ADVISORY_DISCLAIMER`;
  - Kill-switch via `GEV_FEMA_NFHL_ENABLED` throwing `FemaNfhlProviderDisabledError`;
  - Live pinned-fetch path mapped to official FEMA NFHL MapServer layer 28 with strict TLS/host guards.

---

## 3. Consequences

### Positive
- Strict compliance with non-coercion laws: Zone D is never reported as minimal risk; absent BFEs are never coerced to 0 elevation.
- Clear separation between preliminary planning hazard indices (NRI) and regulatory flood hazard layers (NFHL).
- Mandatory statutory disclaimers attached at the contract level prevent liability and misinterpretation.
- Pure domain logic has zero I/O and passes 100% property tests under fast-check.
- Blazing-fast in-memory seed queries (< 0.1ms p95, well under the 25ms threshold).

### Trade-offs & Limitations
- Live NFHL MapServer spatial queries require Esri geometry intersection and pinned-fetch host allowlists (`hazards.fema.gov`);
- Detailed parcel-level flood determinations require surveyor elevation certificates beyond NFHL GIS screening capabilities;
- UI integration and USGS 3DEP elevation integration are reserved for subsequent tasks (11.2 and Phase 11 Exit).
