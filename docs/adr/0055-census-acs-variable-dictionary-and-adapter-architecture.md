# ADR 0055 — Census ACS variable dictionary, boundary contracts, and seed adapter architecture

**Status:** Accepted  
**Date:** 2026-09-21  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.2, §9.1, §10 Task 9.1, AGENTS.md, ADR 0035, ADR 0050, ADR 0052  

---

## 1. Context

In PLAN.md §10 Task 9.1, Phase 9 begins implementing Economic R1 (Market and Business Footprint). The first component requires ingestion and domain mapping for the U.S. Census Bureau American Community Survey (ACS) 5-Year Estimates.

Specific requirements from PLAN.md §9.1 and the authorized 4-Pillar brief:
1. Versioned variable dictionary mapping across ACS 5-year estimates;
2. Retention of estimates, 90% confidence margins of error (MOE), geography, and vintages;
3. Preservation of statutory foreign-born definitions under Census Table `B05002` (must include both naturalized citizens and non-citizens);
4. Support for county, tract, ZCTA, place, state, and nation geographic levels;
5. Pure boundary validation and in-memory indexing achieving < 10ms p95 latency;
6. Strict seed mode enforcement: zero external network calls without explicit developer authorization;
7. Zero numeric zero-coercion: Census Bureau special suppression and annotation codes (`-666666666`, `-888888888`, `-999999999`, `-555555555`) must map to explicit discriminated estimates (`suppressed` or `unavailable`) and never to zero.

---

## 2. Decision

### 2.1 Contracts Layer (`packages/contracts/src/censusAcs.ts`)
- Added strongly-typed Zod schemas:
  - `CensusAcsVariableIdSchema`: uppercase alphanumeric with underscores;
  - `CensusAcsTableIdSchema`: uppercase alphanumeric table identifier;
  - `CensusAcsVintageSchema`: 4-digit or 5-year span;
  - `CensusAcsVariableDefinitionSchema`: defines variable metadata, universe, unit, supported geographies, and enforces the statutory requirement that `B05002` / `foreign-born-population` includes both naturalized citizens and non-citizens;
  - `CensusAcsVariableDictionarySchema`: versioned dictionary contract with semver;
  - `CensusAcsQuerySchema`: validated query contract enforcing allowed geographies (county, tract, zcta, place, state, nation) and FIPS format rules;
  - `CensusAcsSpecialAnnotationCodeSchema`: maps Census Bureau suppression and annotation codes.

### 2.2 Pure Domain Layer (`packages/economic/src/censusAcsDictionary.ts`)
- Implemented `CENSUS_ACS_VARIABLE_DICTIONARY_V1` containing core economic and demographic variables:
  - `B01003_001E` (`total-population`)
  - `B19013_001E` (`median-household-income`)
  - `B05002_003E` (`foreign-born-population`) with statutory definition
  - `B25077_001E` (`median-housing-value`)
  - `B25064_001E` (`median-gross-rent`)
  - `B19001_017E` (`specialized-bracket-income`)
  - `B15003_022E` (`bachelors-degree-population`)
  - `B08301_001E` (`commute-workers-total`)
  - `B23025_005E` (`civilian-unemployed-population`)
  - `B17001_002E` (`poverty-population`)
- Pure functions `lookupAcsVariable`, `getAcsVariableOrThrow`, `isAcsGeographySupported`, and `validateAcsGeography` (enforces exact FIPS lengths and state/county consistency).
- `parseAcsRawEstimate`: parses raw string/number values and correctly maps negative Census suppression codes (`-666666666` -> `small_sample`, `-888888888` -> `unavailable`, `-999999999` -> `data_quality`, `-555555555` -> null MOE) without numeric zero-coercion.
- Zero-I/O boundary strictly maintained: no filesystem, HTTP, or clock access.

### 2.3 Provider Adapter Layer (`packages/providers/src/censusAcs.ts`)
- Implemented `CensusAcsAdapter`:
  - Default seed mode (`GEV_SEED_MODE=1` or `seedMode = true`) loading `fixtures/census-acs-synthetic-v1.json`.
  - Indexes records in memory by geography key for sub-millisecond query performance (< 0.2ms p95, exceeding the < 10ms threshold).
  - Outbound live calls fail closed immediately with `CensusAcsSeedModeViolationError` unless explicitly authorized.
  - Kill-switch check via `GEV_CENSUS_ACS_ENABLED` throwing `CensusAcsProviderDisabledError`.
  - `getForeignBornPopulation` convenience method verifying statutory definition notes on retrieval.

### 2.4 Deterministic Fixture Expansion (`fixtures/census-acs-synthetic-v1.json`)
- Extended synthetic fixture with explicit records for:
  - ZCTA: `78701` (Median household income)
  - Place: `4805000` (Austin city, TX: Foreign-born population with statutory definition notes)
- Full coverage across county (`48453`), tract (`48453001100`), ZCTA (`78701`), and place (`4805000`).

---

## 3. Consequences

### Positive
- High-assurance boundary validation ensures malformed FIPS codes or missing provenances fail closed immediately.
- Zero numeric zero-coercion prevents suppressed or missing data from misleading SMB digital twin models.
- In-memory indexing delivers p95 query latency under 0.2ms.
- Strict seed mode prevents accidental external queries to api.census.gov.

### Negative / Trade-offs
- Live Census API queries remain blocked and require separate human authorization when live connectivity is scheduled.

---

## 4. Compliance & Verification

- Monorepo tests: 100% green across contracts (127/127), economic (84/84), and providers (71/71).
- Property tests with `fast-check` verify suppression non-coercion and FIPS validation.
- Benchmark: queries execute in < 0.2ms p95 across 100 iterations.
- Biome lint and typecheck passed with zero errors.
- Active Documentation Guard (ADG) passed with zero errors.
