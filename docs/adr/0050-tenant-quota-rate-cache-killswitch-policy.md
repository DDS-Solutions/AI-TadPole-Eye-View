# ADR 0050: Tenant Quota, Rate Limit, Cache Partitioning, and Kill-Switch Policy

- **Status:** Accepted
- **Date:** 2026-09-15
- **Task:** PLAN.md 7.2
- **Extends:** [ADR 0041](./0041-durable-shared-governance-runtime.md),
  [ADR 0043](./0043-m3-ledger-reservation-settlement-and-reconciliation.md)

## Context

PLAN.md §10 Phase 7 introduces tenant isolation. Prior to Task 7.2, provider proxy endpoints and
tool execution operated on a shared global budget cap and unpartitioned in-memory caches and rate limits.
Under high concurrency or adversarial load, a single tenant exhausting its rate limits or budget cap
could starve other tenants, trigger global STASIS, or observe cached responses across tenant boundaries.

Task 7.2 requires strictly protecting quota-consuming provider and economic calls across server proxy
endpoints and shared tool execution by enforcing per-tenant rate limits, caching, tenant-allocated
budgets, and kill-switch policy.

## Decision

1. **Durable Per-Tenant Ledger & Budget Governance (Schema Migration 5):**
   - Added table `governance_tenant_budgets` with `tenant_id` primary key, `cap_microusd`,
     `spent_microusd`, `stasis_active`, `trip_code`, `trip_at`, and `revision`.
   - `SqliteBudgetLedger.reserve()` enforces tenant-scoped budget reservations when `tenant_id`
     is specified in fingerprint components. If the tenant's remaining budget is insufficient, the
     reservation returns `denied` specifically for that tenant, tripping tenant STASIS without
     tripping global STASIS.
   - Resuming tenant STASIS requires an explicit human operator action (`resumeTenant(tenantId, 'human')`).
     Self-resume by AI agents or unauthenticated callers is forbidden.
   - Property tests verify that under randomized concurrent tenant spend sequences, remaining balances
     never fall below zero, and settled spend matches ledger history with zero drift.

2. **Per-Tenant Rate Limiting:**
   - Provider proxy endpoints enforce rate limits partitioned by tenant: `provider:${providerName}:${tenantId}`.
   - Burst consumption by Tenant A returns 429 `TENANT_RATE_LIMITED` with `X-GEV-Tenant-Rate-Limited: true`
     and does not degrade or block Tenant B.

3. **Per-Tenant Cache Partitioning & Immediate Invalidation:**
   - In-memory response caches in `CostGovernor` are partitioned per tenant: `tenantCaches: Map<tenantId, Map<url, CacheEntry>>`.
   - Cache entries precompute `cachedBody` provenance on write so steady-state cache hits return in < 10ms
     without repetitive Zod re-parsing.
   - Immediate cache invalidation is supported via `invalidate(providerName)` and `invalidateTenant(providerName, tenantId)`.
   - Governed tool executor handlers for `set_flag` immediately invalidate provider caches on flag updates.

4. **Kill-Switch Policy:**
   - `CostGovernor` checks `isProviderEnabled(providerName)` before any cache lookup or upstream fetch.
   - Disabled providers immediately fail closed with 503 `KILL_SWITCH_ACTIVE`.

5. **Authentication & Secret Handling:**
   - When `requireAuth` is enabled (production or explicit config), unauthenticated requests to quota-consuming
     endpoints fail closed with 401 `UNAUTHENTICATED_QUOTA_ACCESS`.
   - In local seed mode without auth configured, requests default to `tenant-local` for backward compatibility.
   - No credentials, Bearer tokens, or query secrets are ever stored in rate-limit keys or audit trails;
     only verified `tenant_id` values are retained.

## Consequences

- Strict multi-tenant isolation is enforced at the server proxy and ledger boundary: quota exhaustion,
  burst traffic, or STASIS trips in one tenant do not degrade other tenants.
- Cache hits are partitioned and fast (< 10ms), preventing cross-tenant data leakage.
- Resumption of tripped tenant budgets remains human-only, maintaining strict compliance with Standing Rule 2.
- Schema version in `@gev/governance` is bumped to 5, backed by deterministic migrations.
