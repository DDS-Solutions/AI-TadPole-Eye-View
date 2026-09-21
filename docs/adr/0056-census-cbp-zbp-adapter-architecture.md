# ADR 0056 — Census CBP & ZBP variable dictionary, boundary contracts, disclosure suppression preservation, and seed adapter architecture

**Status:** Accepted  
**Date:** 2026-09-21  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.2, §9.2, §10 Task 9.2, AGENTS.md, ADR 0035, ADR 0050, ADR 0052  

---

## 1. Context

In PLAN.md §10 Task 9.2, Phase 9 (Economic R1: Market and Business Footprint) requires ingestion, boundary contracts, and domain mapping for the U.S. Census Bureau County Business Patterns (CBP) and ZIP Code Business Patterns (ZBP).

Specific requirements from PLAN.md §9.2 and the authorized 4-Pillar brief:
1. Versioned contract mapping across NAICS industry classifications (2 to 6 numeric digits);
2. Preservation of statutory disclosure avoidance suppression under 13 U.S.C. Section 9, mapping employment noise flags (`a` through `m`) to explicit numeric bounds (`lower_bound`, `upper_bound`);
3. Direct tracking of establishment counts (`ESTAB`), paid employment (`EMP`), annual payroll (`PAYANN`), and first-quarter payroll (`PAYQTR1`);
4. Strict annual-statistical-estimate disclaimer wording (`CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER`);
5. Geographic support for county, ZCTA, CBSA, state, and nation (rejecting tract and place levels);
6. Pure boundary validation and in-memory dual indexing (geography + NAICS) achieving < 10ms p95 query latency;
7. Strict seed mode enforcement: zero external network calls without explicit developer authorization;
8. Zero numeric zero-coercion: suppressed cells (e.g. publication symbol `D` or placeholder `0` accompanied by a noise flag) must map to explicit `EconomicEstimateSuppressed` records and never to 0.

---

## 2. Decision

### 2.1 Contracts Layer (`packages/contracts/src/censusCbpZbp.ts`)
- Added strongly-typed Zod schemas:
  - `CensusCbpVariableIdSchema`: `ESTAB`, `EMP`, `PAYANN`, `PAYQTR1`;
  - `CensusCbpEmploymentNoiseFlagSchema`: noise flags `a` through `m` representing employment size classes;
  - `CENSUS_CBP_EMPLOYMENT_NOISE_BOUNDS`: immutable lookup table mapping noise flags to their statutory bounds (e.g. flag `c` -> 100 to 249 employees, flag `m` -> 100,000+ employees);
  - `CensusCbpNaicsCodeSchema`: 2 to 6 numeric digits;
  - `CensusCbpVintageSchema`: 4-digit release year with optional description;
  - `CensusCbpVariableDefinitionSchema` and `CensusCbpVariableDictionarySchema`: versioned dictionary contract;
  - `CensusCbpQuerySchema`: validated query contract enforcing allowed geographies (county, zcta, cbsa, state, nation);
  - `CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER`: statutory disclaimer emphasizing that CBP/ZBP are annual statistical benchmark estimates, not real-time operational headcounts, exact current payroll records, or commercial credit evaluations.

### 2.2 Pure Domain Layer (`packages/economic/src/censusCbpZbpDictionary.ts`)
- Implemented `CENSUS_CBP_VARIABLE_DICTIONARY_V1` containing definitions for:
  - `ESTAB` (`establishment-count`, unit `count`)
  - `EMP` (`paid-employment`, unit `count`)
  - `PAYANN` (`annual-payroll`, unit `USD_thousands`)
  - `PAYQTR1` (`first-quarter-payroll`, unit `USD_thousands`)
- Pure functions `lookupCbpVariable`, `getCbpVariableOrThrow`, `validateCbpGeography`, `validateCbpNaicsCode`, and `getEmploymentNoiseBounds`.
- `parseCbpRawEstimate`: transforms raw string/number values and noise flags into `EconomicEstimate`:
  - Accurately maps publication symbol `D` and placeholder values to `suppressed` (`disclosure_avoidance`) with explicit noise bounds;
  - Maps publication symbol `S` to `suppressed` (`data_quality`);
  - Maps publication symbol `N` or missing cells to `unavailable`;
  - Strictly enforces zero numeric zero-coercion.
- Zero-I/O boundary strictly maintained.

### 2.3 Provider Adapter Layer (`packages/providers/src/censusCbpZbp.ts`)
- Implemented `CensusCbpZbpAdapter`:
  - Default seed mode (`GEV_SEED_MODE=1` or `seedMode = true`) loading `fixtures/census-cbp-zbp-synthetic-v1.json`.
  - In-memory dual indexing by geography key and NAICS code prefix, delivering sub-millisecond query performance (< 0.1ms p95, well under the < 10ms threshold).
  - Outbound live calls fail closed immediately with `CensusCbpSeedModeViolationError` unless explicitly authorized.
  - Kill-switch check via `GEV_CENSUS_CBP_ENABLED` throwing `CensusCbpProviderDisabledError`.
  - Convenience methods `getEstablishments`, `getPaidEmployment`, `getPayroll`, `getEvidenceByNaics`, and `getEvidenceByGeography`.

### 2.4 Deterministic Fixture Expansion (`fixtures/census-cbp-zbp-synthetic-v1.json`)
- Extended synthetic fixture with records for all 4 core variables across both CBP (county) and ZBP (ZCTA):
  - County 48453: `ESTAB`, `EMP`, `PAYANN`, `PAYQTR1` (available), and `EMP` (flag `c`, 100-249 employees) and `PAYANN` (suppressed under 13 U.S.C. § 9);
  - ZCTA 78701: `ESTAB`, `EMP`, `PAYANN`, `PAYQTR1` (available).

---

## 3. Consequences

### Positive
- Strict statutory disclosure avoidance suppression preservation ensures digital twin models receive accurate noise bounds rather than false zeroes.
- Pure domain parsing and high-performance in-memory indexing achieve < 0.1ms p95 query latency.
- Strict seed mode and kill switches protect against unauthorized third-party Census API egress.

### Negative / Trade-offs
- Live Census CBP API queries remain blocked and require separate explicit developer authorization.

---

## 4. Compliance & Verification

- Monorepo tests: 100% green across contracts (134/134), economic (93/93), and providers (81/81).
- Benchmark: queries execute in < 0.1ms p95 across 100 iterations.
- Biome lint and typecheck passed with zero errors.
- Active Documentation Guard (ADG) passed with zero errors.
