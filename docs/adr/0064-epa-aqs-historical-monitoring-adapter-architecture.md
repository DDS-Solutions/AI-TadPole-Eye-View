# ADR 0064 — EPA AQS Historical Regulatory Monitoring Adapter, Criteria Pollutant Dictionary, and Non-Coercion Invariants

**Status:** Accepted  
**Date:** 2026-11-12  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.2, §11.3, AGENTS.md, ADR 0035, ADR 0050, ADR 0052, ADR 0063  

---

## 1. Context

In PLAN.md §10 Task 11.3, Phase 11 (Economic R3: Risk, Resilience, and Accessibility) requires implementing U.S. Environmental Protection Agency (EPA) Air Quality System (AQS) ambient air quality monitoring contracts, parameter metadata, synthetic seed fixtures, and a governed provider adapter.

Specific requirements from PLAN.md §11.3 and the authorized 4-Pillar brief:
1. **Strict Historical / Regulatory Labeling (Never Real-Time AQI):**
   - EPA AQS provides quality-assured historical quarterly and annual regulatory monitoring summaries, **not** real-time Air Quality Index (AQI) or current conditions.
   - Real-time AirNow (`airnowapi.org`) belongs to separate, unapproved future scope and must be strictly rejected if configured as an endpoint.
   - All summary records, pollutant coverage entries, fixture datasets, and query results carry literal `data_classification: 'historical_regulatory_monitoring'`, `is_real_time: false`, and mandatory `EPA_AQS_HISTORICAL_DISCLAIMER`.
2. **Criteria Pollutants Coverage:**
   - Covers the six EPA criteria pollutants and their official 5-digit AQS parameter codes:
     - `O3` (`44201`, ppm)
     - `PM2.5` (`88101`, ug/m3)
     - `PM10` (`81102`, ug/m3)
     - `CO` (`42101`, ppm)
     - `NO2` (`42602`, ppb)
     - `SO2` (`42401`, ppb)
3. **Strict Non-Coercion of Unmonitored Pollutants & Missing Data:**
   - Monitoring stations rarely measure all six criteria pollutants simultaneously, and analyzer maintenance outages produce zero-observation periods.
   - Unmonitored pollutants, zero-observation records (`observation_count === 0`), `null`/empty/`NaN`, or negative summary statistics MUST evaluate to `{ status: 'unavailable', reason: '...' }` and **NEVER** coerce to `0.0` (which would falsely imply clean air).
   - Legitimate `0.0` regulatory readings with `is_monitored: true` and `observation_count > 0` remain `{ status: 'available', value: 0 }`.
4. **Operational Kill Switch, Seed Mode, and Credential Hygiene:**
   - Kill switch `GEV_EPA_AQS_ENABLED` fails closed with `EpaAqsDisabledError`.
   - Seed mode is the default (`GEV_SEED_MODE=1`); live calls to `https://aqs.epa.gov/data/api` require explicit developer authorization (`allowLiveCalls: true`), `GEV_EPA_AQS_EMAIL` / `GEV_EPA_AQS_API_KEY` credentials, and `pinnedFetch` with strict SSRF host/path allowlists. Any query-string credentials are redacted if an outbound error occurs.
5. **Performance Threshold:**
   - Seed-mode query latency p95 < 25ms.

---

## 2. Decision

### 2.1 Contracts Layer (`packages/contracts/src/epaAqs.ts`)
- **Constants:**
  - `EPA_AQS_SCHEMA_VERSION = 1`
  - `EPA_AQS_DEFAULT_VINTAGE = 'EPA AQS Quarterly & Annual Regulatory Summaries (2024)'`
  - `EPA_AQS_BASE_URL = 'https://aqs.epa.gov/data/api'`
  - `EPA_AQS_PROHIBITED_REALTIME_HOST = 'airnowapi.org'`
  - `EPA_AQS_DATA_CLASSIFICATION = 'historical_regulatory_monitoring'`
  - `EPA_AQS_HISTORICAL_DISCLAIMER`
  - `EPA_AQS_CRITERIA_POLLUTANTS = ['O3', 'PM2.5', 'PM10', 'CO', 'NO2', 'SO2']`
- **Schemas:**
  - `EpaAqsMonitoringSiteSchema`: validates `SS-CCC-NNNN` site IDs and `state_fips`/`county_fips` prefix consistency.
  - `EpaAqsSummaryRecordSchema`: quarterly (`quarter` 1–4) and annual (`quarter: null`) regulatory summaries with `.superRefine` enforcing non-coercion whenever `!is_monitored` or `observation_count === 0`.
  - `EpaAqsPollutantCoverageSchema`: per-pollutant coverage summary with `.superRefine` blocking `available` status when `!is_monitored`.
  - `EpaAqsQuerySchema`, `EpaAqsQueryResultSchema`, `RawEpaAqsSummaryResponseSchema`, and `EpaAqsFixtureDatasetSchema`.

### 2.2 Pure Domain Layer (`packages/economic/src/epaAqsDictionary.ts`)
- **Versioned Parameter Dictionary (`EPA_AQS_PARAMETERS_V1`):** complete metadata, standard units, averaging periods, and NAAQS primary standard descriptions for all six criteria pollutants, plus `lookupEpaAqsParameter`, `getEpaAqsParameterCode`, `getEpaAqsPollutantSymbol`, and `listEpaAqsParameters`.
- **Validators & Non-Coercion Helpers:**
  - `validateEpaAqsGeography`: allows `state`, `county`, `cbsa`, `point`, and `bounding_box`.
  - `validateEpaAqsEndpoint`: enforces HTTPS and rejects AirNow endpoints.
  - `parseEpaAqsMeasurement`, `createUnmonitoredEpaAqsSummary`, `summarizeEpaAqsPollutantCoverage`, and `matchesSiteGeography` (reusing `haversineDistanceMeters` from `usgs3depConversions.ts`).
- **Source Registry Integration (`packages/economic/src/sourceRegistry.ts`):**
  - Advanced `epa-aqs` status from `planned` to `seed` with `seed_fixture_id: 'epa-aqs-synthetic-v1'`.

### 2.3 Provider Adapter Layer (`packages/providers/src/epaAqs.ts`, `packages/providers/src/epaAqsWire.ts`)
- `EpaAqsAdapter`:
  - `isEnabled()`, `isSeedMode()`, `loadFixture()`, `getSites(geography?)`, and `querySummaries(query)`.
  - Seed-mode query synthesis explicitly generates unmonitored `unavailable` summary records when `include_unmonitored` is enabled (default `true`) so partial site coverage never silently drops or zero-coerces unmonitored pollutants.
  - Live `pinnedFetch` path enforces `allowedHosts: ['aqs.epa.gov']`, `allowedPaths: [{ host: 'aqs.epa.gov', pathPrefix: '/data/api' }]`, 10s timeout, 5MB cap, and credential redaction on error.

---

## 3. Consequences

### Positive
- Clean separation between historical regulatory EPA AQS monitoring data and unapproved real-time AirNow AQI scope.
- Structural Zod + runtime protection against zero-coercion of unmonitored pollutants or outage periods.
- Sub-millisecond seed-mode queries with zero outbound network calls under `GEV_SEED_MODE=1`.

### Neutral / Follow-Up
- Task 11.4 will implement DOT/BTS accessibility context and pure site-risk functions combining FEMA NRI/NFHL, USGS 3DEP, and EPA AQS screening signals.

