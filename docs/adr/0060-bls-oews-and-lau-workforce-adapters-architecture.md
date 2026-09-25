# ADR 0060 — BLS OEWS and LAU workforce adapters, variable dictionaries, suppression preservation, anti-PII defense, and seed adapter architecture

**Status:** Accepted  
**Date:** 2026-09-24  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.2, §10.1, AGENTS.md, ADR 0035, ADR 0050, ADR 0052, ADR 0056  

---

## 1. Context

In PLAN.md §10 Task 10.1, Phase 10 (Economic R2: Workforce) requires ingestion, boundary contracts, pure domain dictionaries, suppression preservation, anti-PII validation, and provider adapters for two primary U.S. Bureau of Labor Statistics (BLS) programs:
1. **Occupational Employment and Wage Statistics (OEWS)**: Annual benchmark survey estimates of occupational employment and percentile wage distributions for roughly 830 non-farm occupations across nation, states, metropolitan areas (CBSAs), and non-metropolitan counties.
2. **Local Area Unemployment Statistics (LAU)**: Monthly model-based and survey benchmark estimates of civilian labor force, resident employment, resident unemployment, and unemployment rate for geographic areas.

Specific requirements from PLAN.md §10.1 and the authorized 4-Pillar brief:
1. Versioned contracts for BLS OEWS (SOC codes `XX-XXXX`, percentile wages, employment counts) and BLS LAU (17-character series IDs, monthly periods `M01`–`M12`, `M13` annual average, measures `03`–`06`);
2. Zero numeric zero-coercion: missing, top-coded, or suppressed estimates are never coerced to 0;
3. Preservation of statutory disclosure avoidance and reliability standards:
   - OEWS top-coded wage rates (`*`, `(1)`) preserved with explicit lower bounds ($115.00/hr, $239,200/yr);
   - OEWS reliability standards (`**`, `(2)`) preserved as data quality suppression when RSE > 50%;
   - OEWS confidentiality suppression (`(8)`, `D`) preserved as disclosure avoidance;
   - LAU unreleased or unavailable periods (`-`, `***`, `N`) preserved as unavailable;
4. Strict anti-PII defense: reject any employee or applicant personal data (SSN, name, email, phone, applicant ID, candidate ID, salary history) before any domain or network processing;
5. Registered vs unregistered request limit enforcement (BLS API v2 limits: 10 vs 50 series per query, 25 vs 500 queries per day);
6. Strict seed mode enforcement: zero live network calls without explicit developer authorization;
7. Performance threshold: query and parsing throughput < 50ms p95 (achieved < 0.1ms p95 via in-memory indexing).

---

## 2. Decision

### 2.1 Contracts Layer (`packages/contracts/src/blsOews.ts`, `packages/contracts/src/blsLau.ts`)
- **BLS OEWS**:
  - `BlsSocCodeSchema`: Standard Occupational Classification format `^[0-9]{2}-[0-9]{4}$`;
  - `BlsOewsVariableIdSchema`: `TOT_EMP`, `EMP_PRSE`, `H_MEAN`, `A_MEAN`, `MEAN_PRSE`, `H_PCT10`, `H_PCT25`, `H_MEDIAN`, `H_PCT75`, `H_PCT90`, `A_PCT10`, `A_PCT25`, `A_MEDIAN`, `A_PCT75`, `A_PCT90`;
  - `BlsOewsUnitSchema`: `USD`, `USD_per_hour`, `count`, `percent`, `ratio`;
  - `BlsOewsWageTypeSchema`: `annual`, `hourly`, `employment`, `general`;
  - `BlsOewsVariableDefinitionSchema` & `BlsOewsVariableDictionarySchema`;
  - `BlsOewsQuerySchema`: validates allowed geographies (`cbsa`, `state`, `nation`, `county`), enforces unregistered vs registered series limits, and rejects any employee/applicant personal data;
  - `BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER`: statutory disclaimer emphasizing that OEWS estimates are annual non-farm benchmark surveys, not real-time job openings or worker-level compensation records.
- **BLS LAU**:
  - `BlsLauMeasureCodeSchema`: `03` (unemployment rate), `04` (unemployed count), `05` (employed count), `06` (civilian labor force);
  - `BlsLauVariableIdSchema`: `LAU_RATE`, `LAU_UNEMPLOYED`, `LAU_EMPLOYED`, `LAU_LABOR_FORCE`;
  - `BlsLauPeriodSchema`: `M01` through `M12` (monthly) and `M13` (annual average);
  - `BlsLauYearSchema`: 4-digit year format `20XX`;
  - `BlsLauSeasonalCodeSchema`: `U` (not seasonally adjusted) and `S` (seasonally adjusted);
  - `BlsLauSeriesIdSchema`: canonical 17-character series identifier format `^LA[US][A-Z0-9]{14,17}$`;
  - `BlsLauVariableDefinitionSchema` & `BlsLauVariableDictionarySchema`;
  - `BlsLauQuerySchema`: validates allowed geographies (`county`, `cbsa`, `state`, `nation`), enforces series limits, and validates anti-PII boundaries;
  - `BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER`: disclaimer emphasizing resident employment status rather than payroll workplace job counts.

### 2.2 Pure Domain Layer (`packages/economic/src/blsOewsDictionary.ts`, `packages/economic/src/blsLauDictionary.ts`)
- **OEWS Dictionary**:
  - `BLS_OEWS_VARIABLES_V1` and `BLS_OEWS_VARIABLE_DICTIONARY_V1` providing zero-I/O definitions;
  - `lookupOewsVariable` and `getOewsVariableOrThrow`;
  - `validateOewsGeography` and `validateOewsSocCode`;
  - `parseOewsRawEstimate`: zero-coercion parser mapping raw cells to `EconomicEstimate`:
    - Top-coded symbols (`*`, `(1)`) -> `suppressed` (`disclosure_avoidance`) with lower bound $115/hr or $239,200/yr;
    - Reliability symbols (`**`, `(2)`) -> `suppressed` (`data_quality`) when RSE > 50%;
    - Confidentiality symbols (`(8)`, `D`) -> `suppressed` (`disclosure_avoidance`);
    - Unavailable symbols (`***`, `(3)`, `-`, `N`) -> `unavailable`;
    - Valid numbers -> `available`.
- **LAU Dictionary**:
  - `BLS_LAU_VARIABLES_V1` and `BLS_LAU_VARIABLE_DICTIONARY_V1`;
  - `lookupLauVariable` and `getLauVariableOrThrow`;
  - `validateLauGeography`;
  - `buildLauSeriesId` & `parseLauSeriesId`: deterministic series ID builder and parser;
  - `parseLauRawEstimate`: zero-coercion parser for monthly resident labor statistics.

### 2.3 Provider Adapters (`packages/providers/src/blsOews.ts`, `packages/providers/src/blsLau.ts`)
- **`BlsOewsAdapter`**:
  - Default seed mode loading `fixtures/bls-oews-synthetic-v1.json`;
  - In-memory dual indexing by geography key and SOC code;
  - Query latency < 0.1ms p95;
  - Anti-PII defense throwing `BlsPiiIngestionError`;
  - Rate limit verification throwing `BlsRateLimitExceededError`;
  - Kill-switch check via `GEV_BLS_OEWS_ENABLED` throwing `BlsOewsProviderDisabledError`;
  - Convenience methods: `getMedianWages`, `getMeanWages`, `getEmployment`, `getWageDistribution`, `getEvidenceBySoc`, `getEvidenceByGeography`.
- **`BlsLauAdapter`**:
  - Default seed mode loading `fixtures/bls-lau-synthetic-v1.json`;
  - In-memory indexing by geography key, period, and measure;
  - Query latency < 0.1ms p95;
  - Anti-PII defense throwing `BlsLauPiiIngestionError`;
  - Rate limit verification throwing `BlsRateLimitExceededError`;
  - Kill-switch check via `GEV_BLS_LAU_ENABLED` throwing `BlsLauProviderDisabledError`;
  - Convenience methods: `getUnemploymentRate`, `getLaborForce`, `getEmployment`, `getUnemployment`, `getMonthlySummary`, `getEvidenceByGeography`.

---

## 3. Consequences

### Positive
- Robust workforce foundation for digital twins with exact occupational (SOC) and geographic (FIPS/CBSA) mappings;
- Preserves top-coded wage limits and reliability suppression so economic models never encounter artificial zeroes;
- Explicit defense in depth against applicant or employee PII ingestion;
- Blazing-fast in-memory indexed queries (< 0.1ms p95).

### Negative / Trade-offs
- Live BLS API queries remain disabled and require explicit developer authorization and registration tokens.

---

## 4. Compliance & Verification

- Contracts tests: 19/19 files passed, 158/158 tests passed;
- Economic tests: 17/17 files passed, 136/136 tests passed;
- Providers tests: 18/18 files passed, 113/113 tests passed;
- Query latency benchmark: < 0.1ms p95 for both OEWS and LAU;
- Anti-PII validation: verified against applicant and employee personal identifiers;
- Zero-coercion validation: verified against top-coded, suppressed, and unavailable symbols.
