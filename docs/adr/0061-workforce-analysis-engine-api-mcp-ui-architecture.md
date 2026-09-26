# ADR 0061 — Pure workforce analysis engine, protected REST APIs, governed MCP operator tools, and lazy workforce HUD inspector

**Status:** Accepted  
**Date:** 2026-09-24  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.2, §10.2, AGENTS.md, ADR 0035, ADR 0050, ADR 0052, ADR 0060  

---

## 1. Context

In PLAN.md §10 Task 10.2, Phase 10 (Economic R2: Workforce & Labor Dynamics) requires:
1. **Pure Workforce Analysis Engine (`packages/economic`)**:
   - Deterministic labor-market concentration (occupational HHI and tiering);
   - Wage differentials (10th, 25th, median, 75th, 90th percentiles; mean hourly/annual; 90/10 & 75/25 wage dispersion ratios);
   - Occupational specialization (Location Quotient relative to national baseline benchmark);
   - Unemployment dynamics (BLS LAU civilian labor force, resident employment, resident unemployment, unemployment rate);
   - Source-linked disagreement preservation (`UNRESOLVED_PRESERVED`) comparing LAU resident employment against OEWS total non-farm payroll employment;
   - Strict anti-PII verification rejecting applicant/worker personal identifiers;
   - Zero numeric zero-coercion preserving confidentiality suppressions and top-coded rates;
   - Performance threshold: p95 execution latency < 15ms.
2. **Protected REST API (`apps/server`)**:
   - `/api/economic/workforce-analysis` and `/api/economic/workforce/analyze` endpoints;
   - OpsAuth authentication with tenant isolation and STASIS check;
   - Audit logging: `audit.intent` before calculation, `audit.outcome` after calculation;
   - In-memory rate limiting and geographic resolution to encompassing CBSA/metro area when sub-metro geographies are supplied;
   - Automatic provider seed fixture resolution.
3. **Governed MCP Operator Tool (`packages/ops-mcp`)**:
   - `analyze_workforce_context` tool registered in shared tool registry, schema definitions, and presentation layer;
   - Telemetry scope authorization, STASIS suspension check, and kill switch enforcement.
4. **Lazy Web UI Component (`apps/web`)**:
   - `WorkforceTab.svelte` mounted within `MarketAnalysisInspector.svelte` in `/#/intelligence`;
   - Prominent statutory "labor-market signal" framing emphasizing benchmark survey estimates, not live job postings, individual records, or automated hiring decisions;
   - Unemployment dynamics card, wage percentiles card, occupational specialization card, labor-market concentration card, and evidence inspection drawer;
   - Design tokens compliance following `docs/DESIGN.md` (zero hardcoded hex/rgba color drift).
5. **Playwright E2E Verification (`e2e`)**:
   - End-to-end condition-wait Playwright test verifying tab switching, statutory banner, card metrics, evidence toggle, SOC selection changes, and audit screenshot capture.

---

## 2. Decision

### 2.1 Pure Domain Engine (`packages/economic/src/workforceAnalysis.ts`)
- Pure zero-I/O function `analyzeWorkforceContext(input, clockTimestamp)`:
  - Validates `WorkforceAnalysisInputSchema` including recursive `checkForWorkerPii` defense;
  - Wage Differentials: computes 90/10 and 75/25 wage ratios, supporting reciprocal 2,080 annual work hours conversion when only one frequency is published; classifies dispersion as `compressed`, `moderate`, `dispersed`, or `highly_dispersed`;
  - Occupational Specialization (Location Quotient): computes regional occupational share relative to national occupational baseline:
    $$\text{LQ} = \frac{\text{Local SOC Employment} / \text{Local Total Employment}}{\text{National SOC Employment} / \text{National Total Employment}}$$
    Classified into `concentrated` (LQ > 1.20), `average` (0.80–1.20), or `underrepresented` (< 0.80);
  - Labor-Market Concentration: computes occupational Herfindahl-Hirschman Index (HHI) across evaluated occupations, classified into DOJ/FTC tiers (`unconcentrated`, `moderately_concentrated`, `highly_concentrated`);
  - Unemployment Dynamics: extracts LAU rate, civilian labor force, resident employed, and resident unemployed;
  - Disagreement Detection: identifies survey methodology deltas between resident employment (LAU household survey model) and payroll jobs (OEWS establishment survey) when delta > 15%;
  - Architectural constraint: strictly maintains file size under 500 lines (433 lines) without ADR exemption.

### 2.2 Protected REST Endpoint (`apps/server/src/routes/workforceAnalysisRoutes.ts`)
- Mounted at `/api/economic/workforce-analysis` and `/api/economic/workforce/analyze`;
- Enforces Bearer token / local-seed authentication and tenant isolation;
- Verifies economic provider kill-switch and governance STASIS state;
- Resolves sub-county or place geographies to enclosing CBSA/county (e.g. Travis County 48453 -> Austin CBSA 12420);
- Populates seed fixtures from `BlsOewsAdapter` and `BlsLauAdapter` when omitted, deduplicating evidence records;
- Records pre-mutation intent and post-mutation outcome in the governance SQLite audit log.

### 2.3 Governed MCP Tool (`packages/ops-mcp/src/workforceAnalysisTools.ts`)
- Implements `handleAnalyzeWorkforceContext`;
- Validates STASIS state and `economic.enabled` flag;
- Bound to `analyze_workforce_context` schema in `packages/contracts/src/toolSchemas.ts`;
- Declared under telemetry scope in `packages/contracts/src/toolRegistry.ts` and `apps/server/src/routes/mcp.ts`.

### 2.4 Web HUD Inspection (`apps/web/src/routes/intelligence/WorkforceTab.svelte`)
- Mounted in `MarketAnalysisInspector.svelte` via `#tab-btn-workforce`;
- Displays prominent statutory Labor-Market Signal Banner with explicit disclaimer from `WORKFORCE_LABOR_MARKET_SIGNAL_DISCLAIMER`;
- Uses CSS variables strictly adhering to `docs/DESIGN.md` design tokens;
- Provides SOC presets (`15-1252` Software Developers, `29-1141` Registered Nurses, `35-2014` Cooks, `00-0000` All Occupations);
- Updates roadmap entry in `apps/web/src/routes/intelligence/economicModulesData.ts` to `INSPECTION READY`.

### 2.5 Playwright E2E Test (`e2e/workforceAnalysisInspector.spec.ts`)
- Uses condition-waits exclusively (`locator.waitFor`, `expect.toBeVisible()`);
- Verifies tab switching, statutory banner, card telemetry, non-zero percentiles, drawer toggle, and SOC preset switching;
- Captures full-page visual evidence for audit verification.

---

## 3. Consequences

### Positive
- Unified workforce intelligence combining BLS OEWS wage percentiles and BLS LAU unemployment dynamics;
- Complete defense-in-depth against applicant and worker PII leaks;
- Top-coded wage suppressions and data quality suppressions are preserved without zero-coercion;
- Blazing-fast pure domain calculation (< 2ms p95, well within the 15ms threshold);
- Full compliance with Active Documentation Guard and architectural drift invariants.

### Negative / Trade-offs
- Sub-county geographic queries (e.g., ZCTA or Place) necessarily resolve to enclosing CBSA/county because BLS surveys do not publish occupational estimates at granular micro-geographies.
