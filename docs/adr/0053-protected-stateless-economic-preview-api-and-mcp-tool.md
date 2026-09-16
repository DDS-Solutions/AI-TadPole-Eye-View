# ADR 0053 — Protected stateless economic preview API and MCP operator tool through shared governance

**Status:** Accepted  
**Date:** 2026-09-16  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §8.2, §10 Task 8.4, AGENTS.md, ADR 0031, ADR 0041, ADR 0050, ADR 0052  

---

## 1. Context

In PLAN.md §8.2 and §10 Task 8.4, GEV v2 requires a protected, stateless preview capability for SMB digital twin business contexts. This mechanism provides on-demand synthesis of local economic context—incorporating demographic profiles (Census ACS), business employment patterns (Census CBP/ZBP), occupational wage benchmarks (BLS OEWS), labor market metrics (BLS LAU), natural hazard ratings (FEMA NRI), and commercial amenities (OSM commercial)—to support AI-Tadpole-OS end users.

Key operational constraints mandated by the system architecture:
1. **Stateless Execution & Zero Persistence:** Previews must not write to any business tables, caches, or filesystems. The only permissible mutation is logging `audit.intent` before execution and `audit.outcome` after execution to the SQLite WAL audit sink.
2. **Dual Exposure:** The preview functionality must be available via both standard HTTP REST endpoints (`POST /api/economic/preview` and `POST /api/economic/business-context/preview`) in `apps/server` and as a governed operator MCP tool (`preview_business_context`) in `packages/ops-mcp`.
3. **Shared Governance:** Both surfaces must route through the shared governance runtime (`packages/governance`), strictly enforcing tenant isolation, authenticated identity verification, kill switches, per-tenant rate limits, and global/tenant STASIS lockdown.
4. **Honest Estimation & Legal Disclaimer:** Suppressed data points must never be coerced to numeric zero, and all outputs must carry the statutory legal disclaimer.
5. **Performance Threshold:** Stateless preview generation must respond within 25ms p95.

---

## 2. Decision

### 2.1 Contracts & Tool Registration
- **Schemas:** Defined `BusinessContextInputSchema` and `BusinessContextPreviewSchema` in `packages/contracts/src/economic.ts`, aliased as `PreviewBusinessContextInputSchema` and `PreviewBusinessContextOutputSchema` in `packages/contracts/src/toolSchemas.ts`.
- **Tool Registry:** Registered `preview_business_context` in `OPERATOR_TOOLS` within `packages/contracts/src/toolRegistry.ts`, assigning required scope `['read.telemetry']`.
- **MCP Presentation Hints:** Configured tool presentation hints in `MCP_TOOL_PRESENTATION_POLICY`: `{ destructiveHint: false, idempotentHint: true, openWorldHint: false }`.

### 2.2 Shared Fixture Ingestion
- Implemented `EconomicFixtureAdapter` in `packages/providers/src/economicFixtures.ts` to load, validate, and cache all six canonical synthetic economic fixtures (`census-acs`, `census-cbp-zbp`, `bls-oews`, `bls-lau`, `fema-nri`, `osm-commercial`).
- Implemented `generateBusinessContextPreview` in `packages/ops-mcp/src/economicPreview.ts`, performing pure synthesis via `@gev/economic` routines and attaching validated provenance and legal disclaimer.

### 2.3 HTTP API Route Policy (`apps/server`)
- Mounted `createEconomicRouter` at `/api/economic`, handling `POST /preview` and `POST /business-context/preview`.
- **Authentication & Tenant Authorization:** Injected `OpsAuthAdapter` validates bearer credentials. Missing or invalid tokens fail closed with 401. Cross-tenant mismatch between token tenant and requested `X-GEV-Tenant` header fails closed with 403 `TENANT_ACCESS_DENIED`.
- **Kill-Switch Guard:** When `isProviderEnabled('economic')` is false, requests immediately abort with 503 `KILL_SWITCH_ACTIVE`.
- **STASIS Guard:** When global STASIS is active, requests fail with 423 `STASIS_ACTIVE`. When a tenant-specific STASIS is active in `SqliteBudgetLedger`, requests for that tenant return 423 `TENANT_STASIS_ACTIVE` without degrading unaffected tenants.
- **Per-Tenant Rate Limiting:** Enforces independent token bucket rate limiting per tenant. Bursts from Tenant A returning 429 `RATE_LIMITED` with `Retry-After` headers do not degrade Tenant B.
- **Audit Logging:** Every mutating or billable request records `audit.intent` before execution and `audit.outcome` after execution. No other persistence writes occur.

### 2.4 MCP Operator Tool Policy (`packages/ops-mcp`)
- Registered `preview_business_context` handler in `packages/ops-mcp/src/tools.ts` executed through `GovernedToolExecutor`.
- Adheres to the exact same shared governance runtime context: tenant isolation, STASIS lockdown, kill-switch verification, and WAL audit logging.

### 2.5 Data Invariant & Disclaimer Enforcement
- **Suppression Preservation:** Metrics with `status: 'suppressed'` or `'unavailable'` maintain null/undefined values and are never coerced to `0`.
- **Statutory Disclaimer:** Every output includes `ECONOMIC_LEGAL_DISCLAIMER`:
  > *"Economic results are decision-support signals, not guarantees, appraisals, legal advice, underwriting decisions, or automated employment decisions."*

---

## 3. Consequences

### Positive
- Unified governance model ensures identical security, rate-limiting, and auditing guarantees across both REST and MCP surfaces.
- Complete statelessness eliminates database migrations, cache invalidation bugs, and cross-tenant persistence leakage.
- In-memory fixture evaluation easily surpasses the performance threshold, executing in < 5ms (well below the 25ms p95 threshold).

### Negative / Trade-offs
- Because preview responses are stateless and not persisted, clients must retain their returned `preview_id` and payload or re-invoke the API for subsequent analysis sessions.

---

## 4. Verification

1. `apps/server/test/economicRoutes.test.ts`: 9/9 tests verifying endpoints, auth failure modes, STASIS isolation, kill switch, tenant rate limiting, WAL audit logging, suppression preservation, and < 25ms p95 latency.
2. `packages/ops-mcp/test/previewBusinessContext.test.ts`: 5/5 tests verifying schema compliance, tool executor integration, suppression preservation, STASIS lockdown, and JSON-RPC over stdio.
3. `packages/providers/test/economicFixtures.test.ts`: 6/6 tests verifying fixture loading and caching.
4. Monorepo automated test suite: 100% green across all packages.
