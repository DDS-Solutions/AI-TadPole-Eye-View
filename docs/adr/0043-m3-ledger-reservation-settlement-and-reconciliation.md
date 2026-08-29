# ADR 0043: M3 ledger reservation, settlement, refund, and reconciliation

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decision owner:** Developer approval of OQ-3
- **Contract:** `gev.m3.ledger.v1`

## Context

M2 verifies approval, but it does not prevent a retry, crash, timeout, or second process from
executing the same mutating or billable intent twice or charging the budget twice. M3 therefore
needs a transport-independent durable operation record that reserves the declared maximum cost
before dispatch and commits the terminal accounting result with its audit outcome.

This decision resolves OQ-3. It is local and seed-safe: it authorizes no live-service call and no
production write.

## Decision

### Durable authority and amounts

M3 uses the same versioned SQLite governance database and `BEGIN IMMEDIATE` unit of work as the
shared budget/STASIS authority. There is no process-local fallback. Costs, caps, reservations, and
settlements are non-negative integer micro-USD values within JavaScript's safe-integer range.

Available funds are:

```text
max(0, cap - settled spend - sum(max reservations in RESERVED, EXECUTING, or IN_DOUBT))
```

A reservation whose maximum equals available funds is allowed. A larger reservation, or any new
reservation during STASIS, is denied durably. Insufficient funds also trips durable
`BUDGET_BREACH` STASIS. A zero-cost mutating action still requires a reservation.

The v1 period is the persisted current period and has no automatic rollover. Operations remain
bound to that period and settle truthfully after their reservation deadline. Adding a period end
or rollover is a separate decision.

### Idempotency binding

The caller supplies one UUID operation ID and reuses it for the same logical intent after every
non-success response. The operation ID is also the audit-intent ID. A caller must not mint a new
operation ID to bypass an `IN_PROGRESS`, `IN_DOUBT`, conflict, timeout, or ledger-unavailable
answer.

At first reservation, the ledger binds a SHA-256 fingerprint over canonical JSON with this exact
versioned component set:

```text
contract_version, fingerprint_version, actor, tenant_id, action,
validated input, task_ref, mutating flag, declared min/max/currency estimate
```

Missing tenant identity is represented explicitly as `null`; a missing executor actor is
normalized to `ai` before binding. The canonical components and their versions are stored beside
the fingerprint. An advisory lookup may avoid work, but authoritative key/fingerprint resolution
always happens inside the reservation transaction.

Future contract versions must retain the decoder for every stored fingerprint version until its
operations are terminal and outside retention. A retry is compared using the bind-time component
version; a deploy must not silently recompute an active operation with a newer policy. In v1, the
tool registry/ports version is not an implicit fingerprint component.

Same key and same fingerprint returns the durable original status/result without redispatch or
new spend. Same key and different bound components returns `IDEMPOTENCY_CONFLICT` and never
dispatches.

### State machine and ordering

The database permits only:

```text
RESERVED -> EXECUTING -> SETTLED
    |            |
    |            +-------> IN_DOUBT -> SETTLED | REFUNDED
    +--------------------> REFUNDED
    +-- initial denial --> DENIED
EXECUTING ----------------> REFUNDED (only with evidence of no effect and no charge)
```

Terminal `SETTLED`, `REFUNDED`, and `DENIED` rows are immutable. SQLite checks and triggers, not
only application code, enforce transitions and terminal immutability.

For a reserved tool, the shared executor performs:

1. validate the tool and input;
2. atomically bind the operation, write `audit.intent`, and reserve the declared maximum;
3. request M2 approval when required;
4. refund before dispatch on approval denial/unavailability;
5. conditionally transition `RESERVED -> EXECUTING` while the deadline is still future;
6. invoke the handler once;
7. validate and bound the terminal result;
8. atomically settle/refund and write `audit.outcome`.

The expiry path uses a conditional state transition in the same immediate transaction. If an
expiry recovery no longer sees `RESERVED`, it follows the observed `EXECUTING`/terminal state and
does not double-transition.

### Settlement, refund, timeout, and ambiguity

Successful dispatch settles the validated actual cost. An actual cost above the reservation is
recorded in full and trips `COMPLIANCE_DRIFT`; if the resulting spend also meets/exceeds the cap,
`BUDGET_BREACH` takes precedence. Neither trip auto-clears.

Before dispatch, cancellation, M2 denial/unavailability, and expiry refund the reservation with
zero settled cost. After `EXECUTING`, refund is permitted only with persisted human/provider/local
evidence that proves both no effect and no charge. Refund or credit of an already settled charge
is deferred; it remains a manual accounting process until a later compensating-credit contract is
approved.

A handler exception or timeout after `EXECUTING`, loss of settlement acknowledgement, or startup
recovery of an expired `EXECUTING` operation becomes `IN_DOUBT`. Its maximum reservation remains
held, STASIS is tripped with `COMPLIANCE_DRIFT`, retries do not redispatch, and human reconciliation
is required. Startup recovery is synchronous; v1 has no background sweeper.

An expired `RESERVED` operation is refunded during startup recovery. A timeout before durable
dispatch produces no ambiguous side effect and refunds. A timeout after dispatch is ambiguous.

### Durable result and outage policy

The terminal replay value is canonical JSON capped at 256 KiB after canonicalization. If the
validated value exceeds the cap, the ledger stores a bounded `OUTPUT_TOO_LARGE` envelope and the
digest of the original canonical value. V1 has no external immutable-result-reference escape
hatch.

Database lock beyond the configured busy timeout, corruption, migration failure, or unavailable
storage returns the typed `LEDGER_UNAVAILABLE` result; raw SQLite details are not a public
contract. Billable and mutating work fails closed and does not dispatch. Notification to local
audit subscribers happens only after commit and is best effort; the durable rows are authoritative.

### Human reconciliation

Only an authenticated human may reconcile `IN_DOUBT -> SETTLED|REFUNDED`. Reconciliation is a
separate audited action, requires bounded persisted evidence, records actual cost when settled,
and never resumes STASIS automatically. Resume continues to refuse while any `IN_DOUBT` operation
exists. The supported surfaces are the protected server operation and local/connected CLI; no AI,
MCP, or unattended reconciliation tool is advertised.

## Consequences

- All mutating operator tools and billable provider reads must use this reservation lifecycle.
- Retries are safe only when consumers retain and reuse the operation ID.
- Ambiguity intentionally favors duplicate-effect and budget safety over availability.
- Compensating credits, period rollover, background recovery, remote reconciliation, and audit
  hash chaining are explicitly outside task 5.1.4.
