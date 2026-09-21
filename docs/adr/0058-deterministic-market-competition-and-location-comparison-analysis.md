# ADR 0058 — Deterministic market, competition, and location-comparison analysis, source-linked disagreement preservation, and multi-source evidence bundles

**Status:** Accepted  
**Date:** 2026-09-21  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.2, §8.3, §9.4, §10 Task 9.4, AGENTS.md, ADR 0035, ADR 0050, ADR 0052, ADR 0054, ADR 0055, ADR 0056, ADR 0057  

---

## 1. Context

In PLAN.md §10 Task 9.4, Phase 9 (Economic R1: Market and Business Footprint) requires implementing deterministic market, competition, and location-comparison analysis functions, multi-source evidence bundle synthesis (ACS, CBP/ZBP, OSM POIs), and an explicit source-linked disagreement state.

Specific architectural requirements from PLAN.md §8.2, §8.3, and the authorized 4-Pillar brief:
1. **Multi-Source Evidence Bundle Synthesis:** Synthesize unified `EconomicEvidenceBundle` collections across Census ACS demographic/income indicators, Census CBP/ZBP establishment and payroll indicators, and OpenStreetMap commercial POI footprints. Every claim must link to source variables and records.
2. **Explicit Disagreement Preservation:** When derived predictions or benchmark expectations conflict with current observations (e.g. model expectation vs. observed commercial density) or cross-sources diverge (e.g. CBP reported administrative establishments vs. crowdsourced OSM commercial POIs), the system must **preserve both signals** in an explicit, source-linked `DisagreementState` rather than silently selecting or averaging one.
3. **Zero Coercion Law:** Missing, suppressed, or unavailable indicators (e.g. Census CBP disclosure avoidance noise flags) must never be coerced to numeric zero; derived ratios (such as average annual wage or population per establishment) must transparently propagate suppression with bounds and explanatory notes.
4. **Deterministic & Pure Zero-I/O Engine:** All calculations execute as pure functions of explicit inputs and injected timestamps (`SimClock` / ISO string), with zero network or filesystem dependencies.
5. **Performance Threshold:** Synthetic multi-source market comparison analysis must execute in $< 15\text{ms}$ p95.

---

## 2. Decision

### 2.1 Boundary Contracts (`packages/contracts/src/marketAnalysis.ts`)
- Added strongly-typed Zod schemas:
  - `SourceVariableLinkSchema`: binds signal evidence to exact source registry ID, variable ID, metric ID, vintage, and attribution notice.
  - `DisagreementTypeSchema`: `prediction_vs_observation`, `cross_source_divergence`, `temporal_shift`, `status_disparity`.
  - `SourceLinkedDisagreementSchema`: captures expected and observed signals, absolute/relative deltas, direction (`observed_higher`, `observed_lower`, `status_divergence`), severity (`info`, `warning`, `critical`), and strictly enforces `resolution_state: 'unresolved_preserved'`.
  - `DisagreementStateSchema`: aggregates counts by severity and collections of source-linked disagreements.
  - `MarketAnalysisInputSchema` and `MarketAnalysisResultSchema`: demographic summary, business activity, commercial footprint, derived metrics, disagreement state, and evidence bundle with `ECONOMIC_LEGAL_DISCLAIMER`.
  - `CompetitionAnalysisInputSchema` and `CompetitionAnalysisResultSchema`: HHI concentration, competitor density, competitor share of footprint, and cross-source divergence detection.
  - `LocationComparisonInputSchema` and `LocationComparisonResultSchema`: multi-location benchmarking (2 to 10 locations), relative-to-benchmark differentials, integer ranks, and Location Quotient (LQ) specialization comparisons.

### 2.2 Pure Domain Layer (`packages/economic/src/`)
To uphold AGENTS.md Rule 15 (no file exceeding 500 lines) while maintaining strict cohesion, the domain logic is structured into focused modules:
1. `disagreementState.ts`:
   - `evaluateSourceLinkedDisagreement`: compares expected vs. observed estimates across warning (15%) and critical (35%) thresholds, or status disparities; builds immutable `SourceLinkedDisagreement` preserving both signals.
   - `createDisagreementState`: counts and aggregates disagreements.
2. `multiSourceEvidence.ts`:
   - `synthesizeMultiSourceEvidenceBundle`: merges and validates evidence records across ACS, CBP/ZBP, and OSM, applying compliant `DataProvenance`.
   - `findEvidenceRecord`: pure helper for locating metric records.
3. `marketAnalysis.ts`:
   - `analyzeMarketContext`: computes demographic, business, and commercial footprint summaries; computes safe derived ratios (wage, population per establishment) without zero-coercion; detects density expectation and cross-source disagreements.
4. `competitionAnalysis.ts`:
   - `analyzeCompetition`: calculates HHI concentration (DOJ/FTC guidelines), competitor density per km², competitor commercial share, and detects CBP vs. OSM competitor divergences.
5. `locationComparison.ts`:
   - `compareLocations`: benchmarks 2–10 locations across core metrics, computes percentage differentials against benchmark, determines ranks, and evaluates Location Quotients via `calculateLocationQuotient`.

### 2.3 Strict Invariants & Prohibitions
1. **No Silent Resolution or Averaging:** Attempting to resolve conflicting signals into a blended mean or single compromise number is prohibited; both signals must remain inspectable with source variable links.
2. **Fail-Closed Provenance:** Every evidence record and synthesized bundle requires valid `DataProvenance`; records lacking provenance fail schema parsing immediately.
3. **Zero Coercion:** Suppressed estimates with disclosure avoidance noise bounds never coerce to zero.

---

## 3. Consequences

### Positive
- Operators and Tadpole agents receive fully transparent market and competitive assessments with complete claim-to-source traceability.
- Model assumptions that diverge from real-world observations are prominently flagged as evidence of market dynamics (e.g. under-served or over-saturated locations) rather than hidden as computation errors.
- Exceptional performance: multi-source comparison analysis runs in $< 1\text{ms}$ p95 across 500 iterations, beating the $15\text{ms}$ ceiling by more than an order of magnitude.
- Zero-I/O boundary verified by automated static analysis.

### Negative / Trade-offs
- Downstream UI and MCP consumers must render and interpret `DisagreementState` rather than assuming every metric is a single scalar.

---

## 4. Compliance & Verification Gate

1. **Unit & Property Tests:**
   - Contract test suite: `packages/contracts/test/marketAnalysisContracts.test.ts`.
   - Pure domain test suite: `packages/economic/test/marketAnalysis.test.ts`.
   - Property tests verify HHI mathematical bounds ($[0, 10000]$), divergence detection ($\ge 15\%$), and zero-coercion preservation.
2. **Performance Benchmark:**
   - Multi-source comparison latency benchmark: p50 $\approx 0.45\text{ms}$, p95 $\approx 0.88\text{ms}$ (threshold $< 15\text{ms}$).
3. **Architectural Boundary Guard:**
   - Static analysis verifies 0 network/filesystem imports and $\le 500$ lines per file across all economic modules.
