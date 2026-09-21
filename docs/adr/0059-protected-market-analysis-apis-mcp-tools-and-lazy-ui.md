# ADR 0059 — Protected Market Analysis REST Endpoints, Governed MCP Operator Tools, and Lazy Market HUD/UI Inspection Components

**Status:** Accepted  
**Date:** 2026-09-21  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.4, §9.5, §10 Task 9.5, AGENTS.md, docs/DESIGN.md, ADR 0035, ADR 0048, ADR 0050, ADR 0058  

---

## 1. Context

In PLAN.md §10 Task 9.5, Phase 9 (Economic R1: Market and Business Footprint) requires exposing the deterministic market, competition, and location-comparison capabilities developed in Task 9.4 across all three interaction surfaces:
1. **Protected HTTP API (`apps/server`)**: REST endpoints for market analysis, competition analysis, and multi-location comparison.
2. **Governed MCP Operator Tools (`packages/ops-mcp`)**: Operator tools for agentic inspection and Tadpole governance with strict capability scoping.
3. **Lazy Market HUD / UI Inspection Components (`apps/web`)**: Client inspection interface mounted within the lazy `/#/intelligence` route, displaying demographics, business activity, commercial footprint, source-linked disagreements, and evidence drawer without coercing suppressed estimates.
4. **Playwright Evidence Verification (`e2e`)**: Automated browser verification ensuring zero fixed sleeps, correct visual rendering, ODbL attribution, and non-coercion compliance.

Specific architectural constraints:
- **Shared Governance Pipeline**: All HTTP requests and MCP tool calls must enforce authentication, tenant resource authorization, tenant-scoped rate limiting (token bucket), kill-switch (`economic`), budget checks, and STASIS lockdown.
- **Audit-Before-Action & Audit-After-Outcome**: Mutating and query operations write structured `audit.intent` before calculation and `audit.outcome` upon completion with duration and status.
- **Strict Non-Coercion**: Suppressed or missing indicators (e.g. Census CBP disclosure avoidance noise or ACS unavailability) must never coerce to `0` or `$0` in the UI.
- **Bundle Budget**: The lazy `IntelligenceRoute` chunk must remain $\le 25\text{ KB}$ gzip and maintain complete Cesium decoupling.
- **No File Over 500 Lines**: All files must strictly obey the repository file size limit.

---

## 2. Decision

### 2.1 Protected REST Endpoints (`apps/server/src/routes/marketAnalysisRoutes.ts`)
- Mounted under `/api/economic/`:
  - `POST /api/economic/market-analysis` (alias `/api/economic/market/analyze`)
  - `POST /api/economic/competition-analysis` (alias `/api/economic/competition/analyze`)
  - `POST /api/economic/location-comparison` (alias `/api/economic/location/compare`)
- Enforces shared governance:
  - Caller authentication (`operator`, `tenant_admin`, `platform_admin`, `ai_copilot`) and `allowLocalSeed: true` policy for seed mode.
  - Per-tenant token-bucket rate limits (`economic-market-analysis`, `economic-competition-analysis`, `economic-location-comparison`) returning `429` with `Retry-After`.
  - Kill-switch check on provider `economic` returning `503`.
  - Global STASIS check and per-tenant budget stasis check returning `423 Locked`.
  - Auto-populates evidence from `EconomicFixtureAdapter` if omitted in local seed mode.
  - Generates audit events: `audit.intent` before domain execution, `audit.outcome` after with status and duration.
  - Response headers: `Cache-Control: no-store`, `Vary: Authorization, X-GEV-Tenant`.

### 2.2 Governed MCP Operator Tools (`packages/ops-mcp`)
- Added three new tools adhering to the 11-tool operator surface:
  - `analyze_market_context` (scoped to `read.telemetry`)
  - `analyze_competition` (scoped to `read.telemetry`)
  - `compare_locations` (scoped to `read.telemetry`)
- Schema projection in `@gev/contracts/mcp-presentation` marks all three with `readOnlyHint: true`, `idempotentHint: true`, `destructiveHint: false`, `openWorldHint: false`.
- Pre-warms tool JSON schema compilation in `createGevMcpHttpHandler` (`warmSchemaCache`), reducing p95 load latency from $> 800\text{ms}$ to $51.5\text{ms}$.

### 2.3 Lazy UI & Non-Coercion Presentation (`apps/web`)
- Mounted `MarketAnalysisInspector.svelte` inside `apps/web/src/routes/intelligence/IntelligenceRoute.svelte`.
- Sub-components:
  - `MarketContextTab.svelte`: Demographics card, Business activity card, Commercial footprint card with mandatory OpenStreetMap attribution (`© OpenStreetMap contributors (ODbL 1.0)`), and expandable Evidence Inspection Drawer.
  - `LocationComparisonTab.svelte`: Multi-location matrix with benchmark badges and percentage deltas.
  - `formatters.ts`: Dedicated non-coercion formatter (`formatEstimate`) rendering suppressed estimates as `Suppressed (Noise [min, max])` and unavailable estimates as `Unavailable (Reason)`.
  - Zero hardcoded colors; all styles use semantic tokens (`--hud-surface-dark`, `--channel-launch-soft`, `--hud-warning`, etc.) from `hudTokens.css`.

### 2.4 Playwright End-to-End Verification (`e2e/marketAnalysisInspector.spec.ts`)
- Navigates to `/#/intelligence` without triggering Cesium.
- Uses condition-waits (`expect.toBeVisible()`) to verify demographics, business activity, commercial footprint, and ODbL attribution.
- Validates the source-linked disagreement banner (`UNRESOLVED_PRESERVED`).
- Toggles evidence drawer, tests tab navigation to Competition and Location Comparison, and persists full-page visual evidence.

---

## 3. Consequences

### Positive
- Fully integrated Phase 9 surface across HTTP, MCP, and Web UI.
- All non-coercion and provenance guarantees are visibly upheld in the operator interface.
- Lazy chunk size remains compact: `IntelligenceRoute` is $7.38\text{ KB}$ gzip (budget $\le 25\text{ KB}$).
- MCP HTTP load testing runs at $51.5\text{ms}$ p95 across 100 concurrent requests.
- All 17 Playwright E2E tests, 284 server tests, 69 MCP tests, and 152 contract tests pass cleanly.

### Negative / Trade-offs
- `McpServer` tool schemas require pre-warming upon handler initialization to avoid thread stall on the first batch of concurrent HTTP requests.
