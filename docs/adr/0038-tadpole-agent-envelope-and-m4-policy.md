# ADR 0038 — Tadpole AgentEnvelope, Connection Lifecycle, Identity, and Capability Propagation Policy

**Status:** Accepted  
**Date:** 2026-11-12  
**Task:** PLAN.md §10 Task 12.1  
**Deciders:** Core Engineering Team  
**Consulted:** PLAN.md §2, §3, §6, §9.3, §12.1, ADR 0031, ADR 0032, ADR 0041, ADR 0042, ADR 0043  

---

## 1. Context

In PLAN.md §10 Task 12.1 (Phase 12: Tadpole M4 Runtime), GEV v2 finalizes the `AgentEnvelope` (Port 5) and `CapabilityIssuer` (Port 4) runtime mapping, Tadpole agent connection/session lifecycle, identity binding, and per-request capability propagation following the accepted OQ-1 local-only profile (ADR 0032).

Requirements:
1. **Concrete `AgentEnvelope` & `CapabilityIssuer` Port Implementations:**
   - `TadpoleAgentEnvelope` wraps `TaskBrief` into a deterministic 4-Pillar brief (`[SCOPE_CONTRACT]`, `[PERFORMANCE_THRESHOLD]`, `[ARCHITECTURE_MODE]`, `[FAILURE_MODES]`) with a SHA-256 integrity digest (`brief_sha256`) and control-character sanitization.
   - `TadpoleCapabilityIssuer` issues Ed25519-signed `CapToken` payloads using `SimClock`, tracks revoked token digests, and enforces signature + expiration verification fail-closed.
2. **Tadpole Connection Lifecycle (`TadpoleConnectionLifecycle`):**
   - Explicitly models connection states (`disconnected`, `connecting`, `authenticated`, `active`, `draining`, `suspended_stasis`, `closed`) and transport-protocol pairs (`http-2026-07-28` / `2026-07-28` or `stdio-2024-11-05` / `2024-11-05`).
   - Opening a session requires a valid `McpAuthorizationContext`, a valid `CapToken` bound to `authorization.principal`, matching `task_ref` when a `TaskBrief` is supplied, and `STASIS_INACTIVE`.
   - Active sessions transition immediately to `suspended_stasis` when `BudgetGovernor` trips STASIS, fail closed on expiration or closure, and record `audit.intent` + `audit.outcome` on open and close.
3. **Least-Privilege Capability Propagation (No Escalation):**
   - Propagated scopes are always the intersection of `McpAuthorizationContext.scopes`, `TadpoleAgentSession.granted_scopes`, and `CapToken.claims.scopes`.
   - `GovernedToolExecutor` verifies `context.capability_scopes` against `OPERATOR_TOOL_REQUIRED_SCOPES` prior to handler execution (`CAPABILITY_DENIED` on missing scopes).
   - MCP HTTP (`apps/server/src/routes/mcp.ts` + `mcpTadpoleAuth.ts`) validates `x-tadpole-cap-token` and `x-tadpole-session-id` headers when present and narrows request scopes prior to tool discovery and dispatch.

---

## 2. Decision

- Added contracts in `packages/contracts/src/agentEnvelope.ts` (`TadpoleConnectionStateSchema`, `TadpoleTransportModeSchema`, `TadpoleWrappedBriefSchema`, `TadpoleAgentSessionSchema`, `TadpoleCapabilityPropagationSchema`).
- Added `capability_scopes`, `envelope_task_ref`, and `CAPABILITY_DENIED` to `packages/core/src/{toolExecutionTypes,toolExecutor}.ts`.
- Added `TadpoleCapabilityIssuer` and `TadpoleAgentEnvelope` in `packages/governance/src/agentEnvelope.ts`.
- Added `TadpoleConnectionLifecycle` and `TadpoleLifecycleError` in `packages/governance/src/tadpoleSessionLifecycle.ts`.
- Exposed `capabilityIssuer` and `agentEnvelope` on `GovernanceRuntimeContext` (`packages/governance/src/runtimeContext.ts`).
- Propagated `capability_scopes` and `envelope_task_ref` in `packages/ops-mcp/src/httpAdapter.ts` and added header-based narrowing in `apps/server/src/routes/mcpTadpoleAuth.ts` and `apps/server/src/routes/mcp.ts`.

---

## 3. Consequences

### Positive
- All five governance ports (`AuditSink`, `ApprovalGate`, `BudgetGovernor`, `CapabilityIssuer`, `AgentEnvelope`) are now concretely implemented and wired into the shared runtime.
- Per-request capability propagation strictly enforces least-privilege narrowing and rejects expired, revoked, or subject-mismatched Tadpole tokens fail-closed.

### Neutral / Follow-Up
- Tasks 12.2 and 12.3 will exercise M1–M4 showcase flows and failure drills against this finalized lifecycle.

