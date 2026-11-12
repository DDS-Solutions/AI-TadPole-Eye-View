# ADR 0065 — DOT/BTS Transportation Accessibility Adapter and Pure Site-Risk Screening Engine

**Status:** Accepted  
**Date:** 2026-11-12  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.2, §11.4, AGENTS.md, ADR 0035, ADR 0050, ADR 0052, ADR 0062, ADR 0063, ADR 0064  

---

## 1. Context

In PLAN.md §10 Task 11.4, Phase 11 (Economic R3: Risk, Resilience, and Accessibility) requires implementing approved U.S. DOT / Bureau of Transportation Statistics (BTS) transportation accessibility context and pure site-risk synthesis functions combining Phase 11 datasets (`FEMA NRI/NFHL`, `USGS 3DEP`, `EPA AQS`, `DOT/BTS`) with strict provenance and screening disclaimers.

Key architectural and safety requirements:
1. **Strict Separation of Current Operational Alerts and Long-Term Hazards:**
   - Active operational weather/emergency alerts (`horizon: 'current_operational_alert'`, `is_live_condition: true`) MUST remain strictly separate from long-term structural hazard indicators (`horizon: 'long_term_structural_hazard'`).
   - Transient active alerts must never alter `overall_screening_score` or `long_term_hazards`.
2. **Non-Definitive Screening Language & Mandatory Disclaimers:**
   - Site-risk results carry `is_definitive_advice: false`, `screening_tier` (`elevated_screening_concern`, `moderate_screening_concern`, `low_screening_concern`, `insufficient_data`), and `SITE_RISK_SCREENING_DISCLAIMER`.
   - DOT/BTS accessibility records carry `data_horizon: 'structural_infrastructure_benchmark'` and `DOT_BTS_SCREENING_DISCLAIMER`.
3. **Zero Coercion of Uncovered Geographies & Missing Signals:**
   - Uncovered DOT/BTS geographies (`is_covered: false`), missing metrics, FEMA Zone D (`undetermined_risk_zone_d`), USGS 3DEP off-coverage elevations, and unmonitored EPA AQS pollutants MUST evaluate to `unavailable` / `insufficient_data` and record explicit `data_gaps`.
   - When zero long-term hazard signals are available, `overall_screening_score` MUST evaluate to `unavailable` and `screening_tier` MUST be `'insufficient_data'`.
4. **Explicit Source Attribution:**
   - Every signal reports `source_id`, `product_name`, `vintage`, `geography`, `mode`, and `status`.
5. **Kill Switch & Seed Enforcement:**
   - `GEV_DOT_BTS_ENABLED` fails closed with `DotBtsDisabledError`.
   - `GEV_SEED_MODE=1` is default; live queries require explicit authorization (`allowLiveCalls: true`) and use `pinnedFetch` restricted to `https://data.bts.gov/resource`.

---

## 2. Decision

### 2.1 Contracts Layer (`packages/contracts/src/dotBts.ts`, `packages/contracts/src/siteRisk.ts`)
- `DotBtsAccessibilityRecordSchema`: validates highway/transit/freight/walkability/commute estimates with `.superRefine` blocking `available` status when `!is_covered`.
- `SiteRiskAssessmentResultSchema`: validates multi-source screening output (`overall_screening_score`, `screening_tier`, `long_term_hazards`, `current_operational_alerts`, `accessibility_context`, `source_signals`, `data_gaps`, `is_definitive_advice: false`, `provenance`, `advisory_disclaimer`).

### 2.2 Pure Domain Layer (`packages/economic/src/dotBtsDictionary.ts`, `packages/economic/src/siteRiskAnalysis.ts`)
- `parseDotBtsMeasurement`, `classifyDotBtsAccessibilityTier`, `classifyDotBtsFreightExposure`, `matchesDotBtsGeography`, `validateDotBtsEndpoint`, `validateDotBtsGeography`.
- `assessSiteRisk(input)`: deterministic zero-I/O synthesis engine using injected `isoTimestamp` (SimClock-derived), normalizing available long-term hazard signals while preserving missing/uncovered signals as explicit `data_gaps`.
- Updated `ECONOMIC_SOURCE_REGISTRY['dot-bts-access']` status from `'planned'` to `'seed'` (`seed_fixture_id: 'dot-bts-synthetic-v1'`).

### 2.3 Provider Adapter Layer (`packages/providers/src/dotBts.ts`, `fixtures/dot-bts-synthetic-v1.json`)
- `DotBtsAdapter` implementing deterministic seed replay (`fixtures/dot-bts-synthetic-v1.json`) and SSRF-guarded live `pinnedFetch` integration with `data.bts.gov/resource`.

---

## 3. Consequences

### Positive
- Completes all nine `ECONOMIC_SOURCE_REGISTRY` sources at `seed` status or higher.
- Guarantees current alerts never distort structural hazard scores and missing signals never coerce to low/zero risk.

### Neutral / Follow-Up
- Phase 11 Exit remains unchecked until Phase 11 HUD/UI inspection integration and exit gate verification are authorized and executed.

