# RUNBOOK.md — Operational Procedures & Incident Response

**Status:** Active · **Audience:** Human Operators & AI Agents · **Companion docs:** [PLAN.md](./PLAN.md), [AGENTS.md](./AGENTS.md)

---

## 1. STASIS Protocol (§STASIS)

**STASIS** is an automatic emergency lockdown triggered when budget thresholds, compliance rules, or severe logic errors trip. When STASIS is entered, all mutating operations and autonomous agent loops are immediately suspended.

### What happens during STASIS:
1. `BudgetGovernor.trip(reason, message)` triggers.
2. `stasis_active` is transactionally persisted in the shared SQLite governance state.
3. All autonomous agent actions suspend immediately (no self-resumption allowed).
4. An `audit.outcome` snapshot with status `'blocked'` and the corresponding trip code is logged to the SQLite WAL.

The local governance database path resolves in this order: explicit process option,
`GEV_GOVERNANCE_DB`, legacy `GEV_AUDIT_DB`, then `GEV_DATA_DIR/audit.sqlite`
(default `.gev/audit.sqlite`). All server, CLI, and local MCP processes must resolve
the same path. Never copy, delete, or replace this database to clear STASIS.
Governed status, diagnostics, and audit reads remain available only after their shared
durable-state check succeeds; mutating tools remain blocked until a human resume.

### Trip Code Reference:
| Trip Code | Root Cause | Immediate Operator Remediation |
|---|---|---|
| `BUDGET_BREACH` | Spend met/exceeded the durable cap, or an estimate would exceed it | Review cost allocation via connected `gev status`; resume only after the attempted work is reduced or otherwise remediated |
| `LOGIC_BLOCKER` | Agent encountered unresolvable blocker (~3 consecutive failures) | Inspect audit log `task_ref` via `gev audit tail`; provide human guidance |
| `COMPLIANCE_DRIFT` | Boundary violation (e.g. unpinned fetch attempt, missing audit intent) | Revert offending branch; patch compliance guard |

### Resuming from STASIS (Human-only):
> [!CAUTION]
> AI agents are strictly forbidden from resuming themselves from STASIS. Only a verified human operator may resume the system using `gev resume`.

When the server is online, `gev resume` must succeed through its authenticated human
operations route. A refusal is final and must not fall back to direct database access.
When the server is offline, the local CLI is the explicit human-operated recovery path
and writes the same durable state plus its audit intent/outcome pair.

If an operation is `IN_DOUBT`, resume must refuse until a human reconciles that operation.
Verify provider receipts or local evidence first, then record exactly one resolution with
the original operation ID:

```bash
# Verified no effect and no charge
pnpm gev budget reconcile <operation-id> --refunded \
  --summary "Provider receipt confirms no effect and no charge" \
  --evidence-kind provider_receipt --reference receipt-123

# Verified effect/charge; record the full actual amount
pnpm gev budget reconcile <operation-id> --settled-usd 0.125 \
  --summary "Provider receipt confirms the completed charge" \
  --evidence-kind provider_receipt --reference receipt-124
```

Reconciliation is audited and does not clear STASIS. Never mint a replacement operation ID,
guess a settlement amount, or use reconciliation as a compensating credit. The CLI prefers the
authenticated loopback server and permits local durable-database recovery only when that server
is offline; it refuses a local fallback for a remote server.

```bash
# Step 1: Inspect current system status and trip cause (< 100ms)
pnpm gev status

# Step 2: Verify the durable audit chain before trusting its entries
pnpm gev audit verify

# Step 3: Tail recent audit entries to understand the exact trip context
pnpm gev audit tail --limit 20

# Step 4: Once the root cause is resolved, human operator executes resume override
pnpm gev resume "Budget cap increased after review"

# Step 5: Confirm STASIS state has returned to STASIS_INACTIVE
pnpm gev status
```

`gev audit verify` prefers the connected protected server and otherwise performs a
read-only local inspection. `INVALID` or `UNAVAILABLE` is a stop condition: preserve
the database and WAL files, record the failure code/sequence, and escalate. Never
rehash, truncate, delete, or copy in replacement state to make verification pass.
Approved retention requires a human, an active trusted Ed25519 key, and a signed
versioned boundary; it is blocked during STASIS or while any operation is `IN_DOUBT`.

An offline status is labeled `NON-AUTHORITATIVE OFFLINE SNAPSHOT`: it can inspect the
configured durable file but cannot prove which state an absent server or MCP process
would use. Start the server and re-run status for authoritative confirmation. Changing
`GEV_BUDGET_CAP_USD` does not overwrite an existing persisted cap; a mismatch fails
closed. Budget-period reset and governed cap changes are intentionally deferred to the
post-v1 ledger roadmap.

### Signed M2 approval verification

Production runtimes deny dangerous mutations unless an explicit `SignedApprovalGate`
is composed with a trusted external decision provider and server-side Ed25519 public-key
allowlist. Never place approval private keys in GEV environment variables, fixtures,
logs, browser bundles, or error messages. `LocalM2ApprovalDemoGate` is permitted only
for deterministic non-production seed/test/demo flows.

Approval payloads expire after at most 60 seconds, allow at most 5 seconds of future
clock skew, and use verifier-issued one-time nonces. A nonce or request replay, unknown
signer/key, revoked key, scope/intent mismatch, invalid signature, clock failure, or
SQLite failure must stop before handler dispatch. Do not delete nonce rows to retry a
mutation; task 5.1.4 defines retry and settlement idempotency.

Key rotation uses overlapping active public keys. Mark an outgoing key `retired` with
an exact validity end only after the replacement is distributed; mark a compromised
key `revoked` immediately. The provisional profile and future revision points are in
[ADR 0042](./docs/adr/0042-signed-m2-approval-verification.md).

### Signed M2 approval verification

Production runtimes deny dangerous mutations unless an explicit `SignedApprovalGate`
is composed with a trusted external decision provider and server-side Ed25519 public-key
allowlist. Never place approval private keys in GEV environment variables, fixtures,
logs, browser bundles, or error messages. `LocalM2ApprovalDemoGate` is permitted only
for deterministic non-production seed/test/demo flows.

Approval payloads expire after at most 60 seconds, allow at most 5 seconds of future
clock skew, and use verifier-issued one-time nonces. A nonce or request replay, unknown
signer/key, revoked key, scope/intent mismatch, invalid signature, clock failure, or
SQLite failure must stop before handler dispatch. Do not delete nonce rows to retry a
mutation; task 5.1.4 defines retry and settlement idempotency.

Key rotation uses overlapping active public keys. Mark an outgoing key `retired` with
an exact validity end only after the replacement is distributed; mark a compromised
key `revoked` immediately. The provisional profile and future revision points are in
[ADR 0042](./docs/adr/0042-signed-m2-approval-verification.md).

---

## 2. Telemetry Feeds & Seed Mode Management

GEV v2 enforces **Seed Mode by default**. Zero live API calls occur in development, testing, or CI unless explicitly instructed by a human developer.

### Seed Mode vs Live Mode Toggles:
- **Seed Mode (Default):** `GEV_SEED_MODE=1` — Replays deterministic recorded fixtures from `fixtures/` with zero external network access.
- **Live Mode:** `GEV_LIVE_MODE=1` — Calls external live APIs via `pinned-fetch` with TLS pinning and SSRF protection.

### Feed Diagnostics & Circuit Breaking:
```bash
# Check per-provider health, error rates, and remaining quotas
pnpm gev feeds health

# Inspect SQLite WAL for recent telemetry fetch attempts
pnpm gev audit tail -t mcp-tool-call --limit 10
```

When an upstream provider (e.g. OpenSky Network) is rate-limited or degraded:
1. The server automatically falls back to cached responses or deterministic seed fixtures.
2. Feature flags (e.g. `opensky.enabled`) can be dynamically toggled via the MCP `set_flag` tool or CLI without redeploying code.

---

## 3. Keyless Cesium 3D Globe Baseline & Fallbacks

GEV v2 operates **100% keyless by default** (ADR 0014).
- **Default Base Layer:** Ion-free OpenStreetMap raster imagery provider (`TileMapService` / OSM XYZ raster tiles).
- **No Cesium Ion Token Required:** The globe boots, centers on the target coordinates, and renders live/fixture flight point entities without any API key.
- **WebGL Fallback:** In headless CI and test environments, Cesium boots in headless WebGL mode verified via Playwright screenshot fixtures (`fixtures/` and E2E visual tests).

---

## 4. Active Documentation Guard (ADG) Gate

The **Active Documentation Guard (ADG)** is a hard CI gate preventing documentation drift (PLAN.md §2 Law 7).

```bash
# Run ADG validator across all repository documentation
pnpm docs:check
```

### When ADG Fails:
- **Broken File Link / Path:** A referenced path like `packages/...` or `docs/...` was renamed or deleted. Fix the link or update the documentation to match active code.
- **Dead Symbol Reference:** An exported type, class, or interface was renamed. Cross-check against actual exports in `packages/*/src/index.ts`.

---

## 5. Emergency Incident Response & Ethics Stops (PLAN.md §12)

GEV v2 strictly enforces ethical AI boundaries. If any task or tool call requests or implies:
- **Person-Tracking or De-anonymization** (correlating callsigns with individual passengers or pilots)
- **Facial Recognition or Biometrics**
- **Automated License Plate Recognition (ALPR)** or IMSI-catcher functionality
- **Autonomous Lethal Targeting or Weapons Integration**

**Protocol:**
1. Agent immediately **REFUSES** execution and enters `LOGIC_BLOCKER` STASIS.
2. An `audit.outcome` with `status: 'blocked'` and `error: 'ETHICS_VIOLATION_PLAN_12'` is logged to the WAL.
3. System alerts the human operator and requires formal ADR review.

---

## 6. Standard Developer Verification Commands

```bash
# Full affected monorepo validation
pnpm turbo run lint typecheck test build

# Active Documentation Guard check
pnpm docs:check

# Playwright E2E smoke tests (Cesium WebGL rendering & flight stream)
pnpm gev qa

# Dev server (starts Hono server + Vite web SPA in seed mode)
pnpm gev dev
```

---

## 7. Governed Agent Team Showcase & Telemetry Load Testing

```bash
# Run local governance showcase (durable audit verification plus a shadow-hash illustration)
pnpm gev demo

# Run high-concurrency proxy load verification benchmark
pnpm --filter @gev/server test
```

