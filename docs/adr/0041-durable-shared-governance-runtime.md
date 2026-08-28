# ADR 0041 — Durable shared governance runtime

**Status:** Accepted

**Date:** 2026-08-28
**Task:** PLAN.md 5.1.1

## Context

The server, local stdio MCP process, and CLI previously constructed independent
in-memory `CapBudgetGovernor` instances. A budget breach in one process was therefore
invisible to the others, a restart erased STASIS, and an offline CLI result could look
authoritative even though it proved nothing about the running server. Audit records
were durable in SQLite, but budget and STASIS state were not.

Task 5.1.1 must make that state shared and restart-safe without entering the later
approval, ledger reservation/settlement, executor-consolidation, or audit hash-chain
tasks.

## Decision

1. `createGovernanceRuntimeContext` is the common composition boundary for server,
   CLI local inspection/resume, MCP transport, and operator-tool contexts. It supplies
   one clock, audit sink, budget governor, approval gate, authority descriptor, and
   close lifecycle. Server routes and middleware receive the same object references;
   operator tools retain compatibility fields that point to those same references.
2. The existing local SQLite audit file is also the local governance database. Path
   precedence is explicit `dbPath`, `GEV_GOVERNANCE_DB`, legacy `GEV_AUDIT_DB`, then
   `GEV_DATA_DIR/audit.sqlite` (default `.gev/audit.sqlite`). This preserves existing
   audit data and avoids two local sources of governance truth. Non-memory paths are
   resolved to absolute paths before opening.
3. Schema changes use `governance_schema_migrations`. Version 1 adds a single-row
   `governance_budget_state` table. Migration and state mutations use SQLite
   transactions; mutating state methods use `BEGIN IMMEDIATE`, WAL mode,
   `synchronous=NORMAL`, and a 5-second busy timeout.
4. Monetary state is stored as integer micro-dollars. Caps round down while estimated
   and settled costs round up, so sub-micro-dollar values never become free. This makes
   concurrent additions deterministic and avoids persisted binary floating-point drift
   while preserving the existing dollar-denominated port.
5. A persisted cap, initial spend, or warning threshold cannot be replaced by a new
   process constructor. Conflicting explicit configuration fails closed. Budget-period
   reset and governed cap changes belong to the later M3 ledger scope.
6. Every `state()` call reads SQLite; no cached process-local copy is authoritative.
   Corrupt, locked beyond the bounded timeout, missing, or future-version state throws
   instead of constructing an in-memory fallback.
7. `resume` enforces a human actor inside the governor, not only at HTTP routing.
   A running server rejection is final: the CLI does not bypass it through direct file
   access. Offline CLI resume remains the explicit local human-operated recovery path
   and records audit intent before state mutation and outcome afterward.
8. Health and `get_budget` responses carry a validated governance-authority descriptor.
   Shared on-disk SQLite is authoritative to attached runtimes. CLI output obtained
   while the server is offline is always labeled a non-authoritative snapshot because
   it cannot prove which database an absent process would use.

## Consequences

- Separate server, MCP, and CLI processes observe one durable budget/STASIS row and
  retain it across clean restart or abrupt process exit.
- Windows writer contention is bounded and serialized rather than silently losing
  updates; exhaustion fails closed.
- SQLite schema version 1 is durable runtime state, but it is not the M3 reservation
  ledger and does not make spend check/settlement idempotent. Those guarantees remain
  task 5.1.4.
- Audit records remain unhashed until task 5.1.5. This decision does not claim
  tamper-evident audit storage.
