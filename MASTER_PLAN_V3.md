# GEV v2 + Economic Intelligence — Master Implementation Plan V3

**Organization:** DDS-Solutions
**Plan version:** 3.0
**Verified against repository:** 2026-08-28
**Status:** IN PROGRESS — Phase 5.0 tasks 5.0.1–5.0.4 complete
**Canonical working copy:** `PLAN.md`
**Synchronized named copy:** `MASTER_PLAN_V3.md`
**File-size exception:** ADR 0030 permits this synchronized master-plan pair to exceed 500 lines so the resume protocol, tracker, and evidence remain one atomic source.
**Archived input:** `D:\AI-TadPole-Eye-View-Master Plan V2` — historical only; never edit or resume from it

This plan replaces the inaccurate implementation assumptions in V2. “Complete” means verified by the stated exit evidence, not merely present in a commit or checked in an older plan.

---

## §0 — RESUME PROTOCOL

### 0.1 Machine-readable checkpoint

```text
PLAN_VERSION=3.0
CURRENT_PHASE=5.0
NEXT_TASK=5.0.5
NEXT_TASK_STATUS=READY
LAST_VERIFIED_UTC=2026-08-28
STASIS_OBSERVABILITY=PARTIAL_UNTIL_TASK_5.1.1
IMPLEMENTATION_STARTED=YES
```

The value of `NEXT_TASK` must always equal the first unchecked task in §10. A task may be checked only after its exit evidence is recorded in §17 and both plan files are synchronized.

### 0.2 New-session procedure — perform in this order

1. Read `AGENTS.md` and this §0 completely.
2. Verify the two plan files match: `git diff --no-index --exit-code -- PLAN.md MASTER_PLAN_V3.md`. Any difference is a `DOC_BLOCKER`; reconcile before other work.
3. Run `pnpm gev status`. If it reports `STASIS_ACTIVE`, snapshot and stop. Never self-resume.
4. Until task 5.1.1 makes governance state durable and shared, an offline `STASIS_INACTIVE` result is not authoritative. Limit work to the developer-approved local/seed scope when the server is offline; never infer authorization for live or production operations.
5. Run `git status --short` and `git log --oneline -20`. Preserve all pre-existing changes. Attempt `gh pr list`; if `gh` is unavailable, record that fact instead of claiming there are no open PRs.
6. Read `docs/adr/INDEX.md`. If UI/HUD work is in scope, also read `docs/DESIGN.md`.
7. Find the first unchecked task with `rg -n "^- \[ \]" PLAN.md`; it must match `NEXT_TASK` above.
8. Read that task’s dependencies, exit gates, and 4-Pillar brief. The developer must authorize that exact brief before implementation begins.
9. Create a `codex/` branch unless the developer explicitly chooses another reviewed workflow. Never push directly to `main`.
10. Run the narrowest relevant baseline checks before editing. Record pre-existing failures; do not silently absorb unrelated failures into the task.

### 0.3 End-of-task handoff — mandatory

Before ending a completed implementation task:

1. Run the task’s tests and all affected quality gates.
2. Record commands, results, commit/branch, remaining risks, and any dirty files in §17.
3. Check only work supported by evidence. Never mark a parent phase complete while a child gate is open.
4. Set `NEXT_TASK` to the first remaining unchecked task and update `CURRENT_PHASE`.
5. Apply identical plan-state edits to `PLAN.md` and `MASTER_PLAN_V3.md`; verify them with the diff command above.
6. Update `RUNBOOK.md` for operational lessons and add/update an ADR for non-obvious decisions.
7. Leave a ready-to-paste 4-Pillar brief for the next task.

### 0.4 STASIS and blocker behavior

- `STASIS_ACTIVE` means stop all agents, log the current task reference, report incomplete work, and wait for a human to run `gev resume`.
- After three genuine failed approaches, record `LOGIC_BLOCKER` with evidence and two or three bounded options. Do not thrash.
- Missing approval, uncertain licensing, unavailable production identity, or an unverified external contract is a blocker—not permission to invent a default.
- Ethics-sensitive requests described in §12 always stop for human review.

---

## §1 — MISSION AND VERIFIED BASELINE

### 1.1 Mission

GEV v2 is a governed geospatial and economic-intelligence console for SMB digital-twin users. It combines deterministic provider ingestion, Cesium visualization, operator tools, audit/approval/budget controls, and a future Tadpole runtime connection without weakening privacy, licensing, or human-control boundaries.

### 1.2 Repository reality at V3 creation

| Area | Verified state | Consequence |
|---|---|---|
| CLI status | Reports Phase 4, seed mode, one healthy OpenSky feed; several values are hardcoded | Informational only until 5.0.3 |
| Existing phases | Phase 0–4 commits exist, but multiple checked claims do not match installed dependencies or working gates | Historical, not re-certified |
| Operations auth | `opsAuth` exists and uses `GEV_OPS_TOKEN` | V2’s “stub” claim was false |
| Route protection | `/ops/audit/stream` and mutating `/ops/seed/reload` are registered before `/ops/*` auth | Critical task 5.0.1 |
| Provider health | Server health, feed health, MCP, and CLI use different hardcoded provider sets | Replace with one registry |
| Satellites | Listed in documentation but provider, contract, route, fixture, propagation, layer, and UI wiring are absent | Build as an incomplete layer |
| Cables | A provider file exists with local interfaces and embedded synthetic data; contract, server, layer, fixture, and UI wiring are absent | Complete and validate it |
| MCP | Hand-written stdio JSON-RPC advertises protocol `2024-11-05` | Preserve stdio; redesign HTTP against current spec |
| Governance | Governors/context are separately instantiated and mainly in memory; SQLite audit entries are not hash chained | M4 and remote mutation are blocked |
| Tests | Unit/typecheck baseline passed; full gate failed web lint; Playwright smoke timed out | Repair before feature expansion |
| ADG | Command passes but symbol membership and important document/status drift are not reliably enforced | A passing ADG is not yet proof |
| Web dependencies | MapLibre, Tailwind 4, Redis, and official OTel packages are not installed; full `cesium` and `@cesium/engine` are both present | Do not describe planned stack as installed |

The pre-existing `README.md` worktree modification belongs to the user and is outside this plan-writing task.

---

## §2 — NON-NEGOTIABLE PRINCIPLES

1. **Boundaries are law.** Providers perform I/O; contracts validate boundaries; core remains pure; stores own application state; `cesium-kit` alone owns imperative Cesium objects.
2. **Audit before action.** Every mutating operation records `audit.intent` before execution and `audit.outcome` after success or failure.
3. **STASIS means stop.** It must be durable, shared across processes, and human-resumable only.
4. **Seed mode is the default.** Tests, CI, demos, and ordinary development make zero live-provider calls unless explicitly authorized.
5. **Outbound HTTP uses `pinned-fetch`.** Enforce scheme, host and resolved-IP policy, redirects, timeout, response-size limit, and cancellation.
6. **Time is injected.** Domain/provider logic uses `SimClock`; only clock/infrastructure implementations may call wall-clock APIs directly.
7. **Validate at every trust boundary.** Never replace runtime validation with a TypeScript assertion or `z.custom` placeholder.
8. **One execution path.** UI, CLI, stdio MCP, and HTTP MCP must share tool definitions, validation, governance, audit, and result validation.
9. **Reads can spend money.** Billable or quota-consuming reads require authentication, rate limits, cache policy, kill switch, and budget accounting.
10. **Remote tools are capabilities.** Filesystem paths, flags, logs, screenshots, and diagnostics require explicit scopes, bounded inputs, and tenant isolation.
11. **Untrusted data stays untrusted.** Provider text, business names, OSM tags, documents, and tool output are data—not instructions. Test prompt-injection handling before any LLM receives them.
12. **Licensing is source-specific.** Do not label all output “public domain” or categorically declare it outside database-license obligations without verified terms and an ADR.
13. **No invented status.** Layer/provider counts, health, telemetry, dependencies, protocol versions, and completed gates come from executable registries or verified evidence.
14. **Literal naming only.** No codenames or mythology.
15. **No file over 500 lines without a referenced ADR.** Prefer cohesive extraction over waiver.

---

## §3 — ARCHITECTURE

### 3.1 Repository boundaries

| Path | Responsibility |
|---|---|
| `apps/web` | Svelte 5 SPA and stores; no component-owned Cesium objects |
| `apps/server` | Hono HTTP/WS/SSE surface, auth, cost controls, shared runtime composition |
| `packages/contracts` | Zod schemas for HTTP, events, scenes, tools, ports, provenance, geography, and economics |
| `packages/core` | Pure calculations, clocks, scene/tool orchestration; no provider I/O |
| `packages/security` | Pinned outbound fetch, SSRF defenses, sanitizers, secret-safe helpers |
| `packages/providers` | One validated adapter per external source |
| `packages/cesium-kit` | Imperative Cesium controllers and render queue |
| `packages/governance` | Audit, approval, capability, budget, STASIS, Tadpole adapters |
| `packages/ops-mcp` | Shared operator MCP surface and transports |
| `packages/cli` | `gev` operator commands |
| Economic workspace package | **Planned in Phase 8**: pure economic analysis and source registry; its path does not exist yet |
| `fixtures` | Recorded, licensed, deterministic provider fixtures |
| `e2e` / `load` | Playwright and k6 verification |

### 3.2 Data flow

```text
external source -> pinned-fetch -> provider adapter -> Zod boundary -> cache/store
                                                             |-> UI reads
                                                             |-> cesium-kit subscriber -> rAF queue
                                                             |-> governed tools/evidence
```

No UI component fetches a provider directly. No Cesium animation writes into Svelte runes per frame. No transport builds a separate governor or audit sink.

### 3.3 Installed versus proposed stack

- Treat package manifests and lockfile as installed truth.
- New dependencies require an ADR or PR-body justification, license check, security review, and bundle/server-size measurement.
- MapLibre is proposed for the intelligence view but is not installed. The view must be lazy-loaded and must not load Cesium.
- Do not claim Redis, OpenTelemetry, Tailwind, PWA support, or a provider SDK is complete merely because an older plan listed it.
- Resolve the simultaneous `cesium` and `@cesium/engine` dependency intentionally; do not remove either without bundle and runtime evidence.

### 3.4 Language placement

**TypeScript/Svelte for the product surface and orchestration; Rust for narrowly defined high-assurance or performance-critical services; SQL for persistence; Python only for offline research and data preparation.**

- TypeScript remains the default for the Svelte UI, Cesium integration, contracts, provider adapters, Hono server, MCP/CLI orchestration, and deterministic economic logic.
- Rust enters only behind an ADR-defined interface after profiling or security evidence—for example a durable governance service, high-throughput ingestion, or CPU-intensive geospatial work. Tadpole may remain Rust behind the five ports; do not rewrite working TypeScript for preference alone.
- SQL owns durable query/state semantics through reviewed schemas, migrations, transactions, and repository boundaries. SQLite is the verified local baseline; a production database is a later deployment decision.
- Python is permitted for offline research, fixture preparation, source exploration, and independent validation. It is not a production request-path dependency or parallel source of domain truth; committed outputs must be reproducible, versioned, licensed, and contract-validated.
- React is not part of the selected UI stack. Tailwind is a CSS framework—not a language—and is not currently installed; `docs/DESIGN.md` tokens remain authoritative unless a measured dependency ADR changes that decision.
- Cross-language boundaries use versioned contracts and conformance tests. A new runtime/language requires ownership, build, deployment, observability, security, and rollback plans.

---

## §4 — DATA, PROVENANCE, AND ANALYSIS CONTRACTS

### 4.1 Registry terminology

- **Provider:** one data-source adapter and its operational state.
- **Feed:** a provider-backed stream or query surface.
- **Layer:** a visual presentation; multiple layers may use one provider.
- **Product:** a derived analysis composed from one or more sources.

All counts and health summaries must be derived from one typed registry. Documentation may describe planned entries, but must label them `planned`, `seed`, `download-pack`, or `implemented` rather than adding them to an “active” total.

### 4.2 Required provenance

Every provider and economic response carries validated provenance including source identifier, canonical source URL, retrieval time from `SimClock`, observation period/vintage, mode (`live`, `cached`, `seed`, `download_pack`, `unavailable`), license/terms identifier, attribution, schema version, and fixture/cache identifiers when applicable. Provenance is required, not optional.

### 4.3 Statistical values

Economic values use a discriminated status such as `available`, `suppressed`, `unavailable`, or `not_applicable`. Only `available` carries a numeric value. Suppressed or missing values are never converted to zero. Estimates retain geography, period/vintage, unit, margin of error when supplied, source variable/series identifiers, and warnings.

### 4.4 Geography

Geography is a discriminated union with a required kind and matching identifier/geometry. GeoJSON receives real runtime validation, coordinate bounds, ring/vertex/depth limits, and request-size limits. An empty geography object is invalid.

---

## §5 — SECURITY AND PRIVACY ARCHITECTURE

1. Register authentication middleware before every protected route or mount protected sub-apps under it. Add route-order regression tests.
2. Use one authentication adapter and one environment contract. `GEV_OPS_TOKEN` remains the local compatibility name until an auth ADR replaces it; do not add competing MCP/API-key variables.
3. Compare bearer secrets with a timing-safe helper after fixed-length normalization. Never log credentials.
4. Local stdio MCP needs no network bearer. Development HTTP may use scoped bearer auth. Production remote MCP must follow the applicable MCP authorization specification and validate issuer, audience/resource, expiry, and scopes.
5. Protect all `/ops/*`, `/mcp`, economic queries that consume quotas, persistence, exports, watches, and privileged collaboration roles. Document any intentionally public health endpoint and ensure it exposes no secrets.
6. Restrict scene read/write to an operator-configured root using canonical paths, extension/size limits, atomic writes, and traversal/symlink defenses.
7. Apply request-body, response, stream, concurrency, duration, and rate limits. Validate `Origin` on HTTP MCP to prevent DNS rebinding.
8. Tenant identity and authorization must exist before BusinessContext persistence. Enforce ownership on every read/write/export/delete and redact private business data from logs and telemetry.
9. Treat provider content as adversarial. Preserve data/instruction separation through prompts, evidence rendering, tool calls, and Tadpole envelopes.
10. Live calls and new sources require feature-flag kill switches. Production writes require explicit human approval.

---

## §6 — GOVERNANCE AND THE TADPOLE SEAM

The five ports remain `AuditSink`, `ApprovalGate`, `BudgetGovernor`, `CapabilityIssuer`, and `AgentEnvelope`.

| Rung | Meaning | Required proof |
|---|---|---|
| M1 Observer | External runtime reads health and audit events | Authenticated, redacted, resumable observation |
| M2 Gatekeeper | External signed approval controls mutations | Verified identity, nonce/expiry, replay defense, denial tests |
| M3 Governor | Shared ledger and durable STASIS control spend | Idempotent settlement, cross-process enforcement, human resume |
| M4 Runtime | Tadpole agent operates the governed tool surface | M1–M3 evidence plus end-to-end failure drills |

M4 may not rely on an auto-generated production signing key, `approve_all`, an in-memory governor, a disconnected Merkle helper, or a fail-open Tadpole fallback. Local seed/demo fallbacks must be explicitly configured and visibly labeled.

---

## §7 — MCP AND AI OPERABILITY

### 7.1 MCP transport target

As verified on 2026-08-27, the stable Streamable HTTP reference is protocol `2025-11-25`. Re-check the official specification at implementation time; do not blindly preserve this version if a newer stable version has been adopted by both GEV and Tadpole.

- Preserve stdio transport for local operators.
- Expose one HTTP MCP endpoint, `/mcp`, supporting the specification’s POST and GET behavior; do not create a legacy `/mcp/sse` endpoint.
- Implement required `Accept`, `Origin`, `MCP-Protocol-Version`, session, reconnect/event-ID, JSON/SSE, cancellation, and error behavior.
- Never broadcast one response or notification across unrelated client streams.
- Prefer the official TypeScript SDK after an ADR and compatibility spike; if hand-written transport remains, add protocol conformance tests.
- Advertise `listChanged: true` only when the server actually emits `notifications/tools/list_changed`.
- Derive `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` from explicit semantics; “dangerous” is not equivalent to “destructive.”
- Add output schemas and validated structured content. Preserve GEV governance detail in MCP `_meta`, not non-standard annotation fields.

### 7.2 Shared tool execution

Tool definitions, Zod input/output validation, capability checks, STASIS preflight, budget reservation/settlement, approval, audit, execution, and result validation form one shared pipeline used by web, CLI, stdio MCP, and HTTP MCP.

---

## §8 — PRODUCT SCOPE

### 8.1 Geospatial completion

- Satellites: CelesTrak GP/OMM seed ingestion, validated orbital records, deterministic SGP4 propagation, correct time/frame conversion, Cesium layer, health, provenance, attribution, and offline tests.
- Cables: validated contracts, fixture-based synthetic seed, optional separately licensed download pack, server/store/layer/UI wiring, provenance, and attribution.
- Existing feeds: migrate to the shared registry and required provenance without changing their provider-to-store-to-render boundaries.

### 8.2 Economic intelligence

- R0: contracts, provenance, source registry, fixtures, pure analysis package, protected preview.
- R1: market and business footprint using ACS, CBP/ZBP, and legally reviewed OSM enrichment.
- R2: workforce using BLS OEWS and LAU with exact series/area/period evidence.
- R3: risk/accessibility using verified FEMA, USGS, EPA, and DOT/BTS products with screening disclaimers.
- R4: authenticated tenant BusinessContext, evidence bundles, governed Tadpole tools, watches, exports, and deletion.

Economic results are decision-support signals, not guarantees, appraisals, legal advice, underwriting decisions, or automated employment decisions.

---

## §9 — DECISIONS AND OPEN BLOCKERS

### 9.1 Settled in V3

- `PLAN.md` is the repository source of truth; `MASTER_PLAN_V3.md` is an exact named copy. V2 remains unchanged as historical input.
- The default intelligence URL is `/#/intelligence` until deployment proves history-fallback support; any switch to `/intelligence` requires a routing ADR and hosting test.
- MapLibre is a proposed lazy dependency, not an existing capability.
- Satellite ingestion prefers GP/OMM-compatible data rather than a TLE-only design, because legacy TLE cannot represent all newer catalog identifiers.
- OSM/ODbL classification is decided per actual output and extraction risk; no blanket “not a derived database” claim is allowed.
- Prompt-injection tests occur before economic/provider text reaches an LLM or Tadpole, not in a deferred final phase.

### 9.2 Human decisions with deadlines

| ID | Decision | Must be answered before |
|---|---|---|
| OQ-1 | Tadpole MCP client capabilities, deployment origin, auth issuer/audience, and supported protocol version | Phase 6 implementation |
| OQ-2 | M2 signed-approval format, signer identity, key custody/rotation, nonce and expiry rules | Task 5.1.3 |
| OQ-3 | M3 ledger reservation/settlement/refund/idempotency contract and outage policy | Task 5.1.4 |
| OQ-4 | Production identity provider, tenant model, roles, retention, export, and deletion requirements | Phase 7 |
| OQ-5 | Approved OSM use/output classification and attribution/share-alike obligations | Phase 9 |
| OQ-6 | Economic provider budgets, cache freshness, permitted live environments, and kill-switch owners | Phase 8 |
| OQ-7 | Satellite source terms, redistribution allowance, refresh policy, and production source choice | Task 5.2.3 |

Unanswered questions do not block earlier independent safety work.

---

## §10 — PHASED EXECUTION TRACKER

### Historical phases 0–4 — recorded, not re-certified

The repository contains Phase 0–4 implementation commits. V3 does not repeat their old checked boxes because claims including route protection, dynamic health, Redis, OTel, PWA/MapLibre, source counts, load status, and green smoke tests need evidence reconciliation. Phase 5.0 establishes an honest baseline without deleting working features.

### Phase 5.0 — Safety and source-of-truth bootstrap

- [x] **5.0.1 Secure all existing operations routes.** Move/mount auth before protected handlers; protect audit streaming and seed reload; add route-coverage tests.
- [x] **5.0.2 Repair authentication consistency.** One auth adapter/config, timing-safe comparison, production fail-closed behavior, privileged collaboration-role tests.
- [x] **5.0.3 Create one provider registry.** Derive health, feed/layer/provider counts, modes, CLI status, MCP health, and documentation tables from it.
- [x] **5.0.3a Reconcile release and documentation integrity.** Preserve historical tags, establish the root package manifest as product-version authority, gate release automation, and correct public governance/security/build claims.
- [x] **5.0.3b Make local MCP truthful and confine scene files.** Remove fabricated console-state results from the default stdio surface, sandbox scene I/O, and replace tautological diagnostics with verified evidence.
- [x] **5.0.3c Repair current server and collaboration trust boundaries.** Derive audit identity from auth, enforce human-only resume, harden WebSocket/room boundaries, validate CRDT updates, stop client echo, and add bounded abuse controls.
- [x] **5.0.4 Make ADG meaningful.** Validate symbol membership, paths, phase/status/version claims, plan-copy equality, and designated root docs; distinguish explicitly planned paths from implemented paths.
- [ ] **5.0.5 Restore the quality baseline.** Fix web lint and Playwright smoke timeout by root cause; run uncached affected lint/typecheck/test/build/QA.
- [ ] **5.0.6 Reconcile architectural drift.** Inventory direct wall-clock use, files over 500 lines, hardcoded design colors, duplicate Cesium dependencies, and claimed-but-absent stack items; fix or create scoped follow-up ADR tasks.
- [ ] **5.0 exit:** no unprotected privileged route; status is registry-derived; plan copies match; ADG detects seeded drift; all mandatory baseline gates green.

#### Completed brief for task 5.0.1

```text
[SCOPE_CONTRACT] apps/server/src/index.ts, apps/server/src/middleware/opsAuth.ts,
and focused server authentication/route tests. Out of scope: MCP transport,
economic features, provider refactors, production deployment, and README.md.

[PERFORMANCE_THRESHOLD] With auth required and GEV_OPS_TOKEN configured, every
protected /ops/* route returns 401 without/with invalid bearer credentials;
authorized requests retain existing behavior; missing production configuration
fails closed; focused tests and affected lint/typecheck/test pass; zero live calls.

[ARCHITECTURE_MODE] PLAN.md §2 rules 1–10 and §5. Register protection before
handlers, preserve audit-before-action and STASIS order, and use the existing auth
contract until task 5.0.2. No deviations without ADR.

[FAILURE_MODES] Do not make privileged routes public to preserve a test. Keep an
explicitly public health route minimal and documented. If Hono mount ordering cannot
be proven by tests after three approaches, record LOGIC_BLOCKER with alternatives.
```

#### Completed brief for task 5.0.2

```text
[SCOPE_CONTRACT] apps/server/src/middleware/opsAuth.ts, apps/server/src/index.ts,
apps/server/src/routes/voice.ts, apps/server/src/routes/collab.ts, and focused
server authentication/voice/collaboration tests. Out of scope: MCP transport,
provider/economic work, production deployment, README.md, and later Phase 5 tasks.

[PERFORMANCE_THRESHOLD] One configured auth adapter governs operations, voice-session
provisioning, and privileged collaboration roles; fixed-length normalized bearer
comparison is timing-safe; missing production configuration fails closed; invalid or
missing credentials never mint operator/ai_copilot authority; focused tests and
changed-file lint plus affected typecheck/test pass; zero live calls.

[ARCHITECTURE_MODE] PLAN.md §2 rules 1–10 and §5. Keep GEV_OPS_TOKEN as the sole local
compatibility token, inject one configuration through composition, preserve explicit
local seed behavior, and do not introduce a second auth environment contract. No
deviations without ADR.

[FAILURE_MODES] Never generate a production credential or elevate a caller when auth
configuration is absent. Normalize values before timing-safe comparison so unequal
lengths cannot throw or leak an early mismatch. Preserve viewer-only collaboration
access without granting the requested privileged role. If one adapter cannot cover
all three surfaces after three tested approaches, record LOGIC_BLOCKER with evidence
and bounded alternatives.
```

#### Completed brief for task 5.0.3

```text
[SCOPE_CONTRACT] packages/contracts provider-registry contracts/exports,
packages/providers typed registry/exports, apps/server health composition/routes,
packages/cli status/feeds commands, packages/ops-mcp feed-health tooling, focused
tests, and generated provider documentation tables in DATA_SOURCES.md or a dedicated
generated artifact. Out of scope: provider adapter rewrites, new/live sources, UI
visual redesign, economic work, production deployment, README.md, and later tasks.

[PERFORMANCE_THRESHOLD] One typed registry is the executable source for provider,
feed, and layer identities; implementation state; mode; health; and derived counts.
Server health, feed health, CLI status, MCP feed health, and generated documentation
agree in contract tests; no second hardcoded provider summary remains in those
surfaces; seed tests make zero live calls; changed-file lint and affected
typecheck/test pass.

[ARCHITECTURE_MODE] PLAN.md §2 rules 1–13, §3 boundaries, and §4 registry terminology.
Contracts validate the registry boundary; providers own source metadata; consumers
derive views without mutating registry truth. Preserve provider → store → consumer
boundaries and SimClock usage. No deviations without ADR.

[FAILURE_MODES] Do not conflate provider, feed, and layer counts or mark planned,
download-pack, cable, or satellite work as active. Health must reflect declared
implementation/mode rather than default every entry to healthy. Do not call live
providers to populate status or documentation. If one registry cannot serve all
scoped consumers after three tested approaches, record LOGIC_BLOCKER with drift
evidence and bounded alternatives.
```

#### Authorized brief for task 5.0.3a

```text
[SCOPE_CONTRACT] PLAN.md, MASTER_PLAN_V3.md, VERSION_CONTROL.md, README.md,
SECURITY.md, CHANGELOG.md, .github/workflows/release.yml, the root/runtime version
source, scripts/adg.mjs only for removal of its hardcoded expected version, and
focused documentation/version tests. Preserve the existing README.md terminology
edit. Out of scope: MCP implementation, collaboration/runtime security fixes,
provider/UI work, live services, tag deletion, or history rewriting.

[PERFORMANCE_THRESHOLD] One authoritative version source; no hardcoded ADG expected
version; release automation cannot create another release until the documented human
policy gate passes; root documentation accurately labels seed/demo governance and
current layer state; designated documentation checks pass; focused tests and
typechecks pass; plan copies remain byte-identical; zero live calls.

[ARCHITECTURE_MODE] PLAN.md §2 rules 7 and 13, §3 installed-versus-proposed truth,
§6 M-rung evidence requirements, task 5.0.4 prerequisites, and ADR 0030. Preserve
published tag history and distinguish historical releases from production-readiness
criteria.

[FAILURE_MODES] Do not rewrite or delete existing tags, claim durable tamper evidence,
mark simulated M2/M3 as production integration, or weaken readiness criteria merely
to match current versions. If the future release scheme cannot be selected
unambiguously, record DOC_BLOCKER with bounded choices and stop before changing
release automation.
```

#### Authorized brief for task 5.0.3b

```text
[SCOPE_CONTRACT] packages/ops-mcp/src/tools.ts, packages/ops-mcp/src/server.ts,
focused packages/ops-mcp tests, packages/contracts/src/tools.ts and its focused tests
only where truthful availability/output contracts require change, and packages/cli
demo wording/tests only to preserve explicit simulation labeling. Out of scope: web
tool executors, Streamable HTTP MCP, Phase 5.1 shared-runtime consolidation, server
routes, collaboration/UI work, live services, and production deployment.

[PERFORMANCE_THRESHOLD] Default stdio tools/list exposes only tools backed by current
context state or verified evidence; the six console-only placeholder tools are absent
and direct calls fail explicitly rather than return plausible data. Scene reads and
writes are confined to an operator-configured root (default .gev/scenes), accept only
.json, cap input at 1 MiB, reject traversal/absolute/UNC/symlink escape, and save
atomically without overwriting outside the root. Scene results report only values
derivable from SceneState. Diagnostics pass only after the checked operation succeeds.
Focused tests cover Windows/POSIX traversal, symlink escape where supported,
oversized input, unsupported tools, audit ordering, and zero live calls; changed-file
lint plus affected typecheck/test pass.

[ARCHITECTURE_MODE] PLAN.md §2 rules 1, 7, 8, 10, and 13; §5 rules 6–8; §7.2 shared
tool truth; and the local-stdio exception in §5 rule 4. Fail closed at capability and
filesystem boundaries. Preserve the CLI demo only as visibly labeled simulation; do
not pre-implement HTTP MCP or the Phase 5.1 shared context.

[FAILURE_MODES] Never make fabricated output acceptable merely by adding a subtle
simulated flag, never authorize arbitrary paths because stdio is local, and never use
string-prefix containment. Do not follow a symlink outside the configured root or
leave a partially written scene. If cross-platform canonical confinement cannot be
made deterministic after three tested approaches, record LOGIC_BLOCKER with failing
path cases and bounded alternatives.
```

#### Ready-to-authorize brief for NEXT_TASK 5.0.3c

```text
[SCOPE_CONTRACT] apps/server/src/index.ts, apps/server/src/middleware/opsAuth.ts,
apps/server/src/routes/{collab,voice}.ts, packages/contracts/src/collab.ts,
packages/core/src/collabDoc.ts, apps/web/src/stores/collab.svelte.ts,
apps/web/src/components/CollabBar.svelte, packages/cesium-kit/src/collabLayer.ts, and
focused core/server/web-compatible tests. Out of scope: production identity/tenancy,
HTTP MCP, provider refactors, follow-camera redesign, live services, and Phase 5.1
durable governance.

[PERFORMANCE_THRESHOLD] Audit actor comes only from the auth decision; tokenless local
seed access cannot perform human-only resume. WebSocket Origin comparison is parsed
and exact, missing Origin is rejected, and URL room ID must equal the verified token
room. Room enumeration/detail requires operations auth. Join responses contract-validate
the assigned role and clientId; self-presence is not rendered or followable. Authorized
CRDT updates validate on a staged document before commit, invalid updates do not poison
the room, and remote-origin updates are never echoed. In-memory limits enforce at most
5 voice sessions, 20 joins, and 20 WebSocket upgrades per client per minute pending
Phase 7 tenant policy. Focused spoofing, Origin, room-binding, poisoning, echo, limit,
and role-downgrade tests pass with injected clocks and zero live calls.

[ARCHITECTURE_MODE] PLAN.md §2 rules 1, 6–10, and 13; §5 authentication, origin,
limits, and human-resume requirements; existing viewer-only seed access; and the
providers → stores → UI/Cesium boundary. Use design tokens for touched UI and read
docs/DESIGN.md before UI edits. No new auth environment contract or transport-specific
governor.

[FAILURE_MODES] Never trust X-Actor, silently treat local-dev as human, mutate the live
Y.Doc before validation, rebroadcast remote updates, compare Origin by prefix, or make
room IDs decorative. Rate limits must not call live services or rely on wall-clock in
tests. If staged Yjs validation cannot preserve valid concurrent updates after three
tested approaches, record LOGIC_BLOCKER with minimal binary fixtures and bounded
alternatives.
```

#### Completed brief for task 5.0.4

```text
[SCOPE_CONTRACT] scripts/adg.mjs, focused ADG fixture/test harness and package
scripts, read-only validation of designated root documentation and source exports,
and the synchronized plan checkpoint pair. Out of scope: product feature code,
provider/runtime refactors, UI/HUD changes, live services, production deployment,
and rewriting pre-existing README.md prose unless a DOC_BLOCKER is separately
authorized for reconciliation.

[PERFORMANCE_THRESHOLD] The current repository passes `pnpm docs:check`; seeded
missing paths, missing symbol membership, stale phase/status/version claims, and
PLAN.md/MASTER_PLAN_V3.md drift each fail deterministically with actionable file and
line evidence. Explicitly planned paths pass only through a narrow documented marker,
not a broad allowlist. Focused ADG tests, changed-file lint, and affected
typecheck/test pass.

[ARCHITECTURE_MODE] PLAN.md §2 rules 7 and 13, §3 installed-versus-proposed truth,
§10 task 5.0.4, and ADR 0030 plan-copy invariants. Validate symbols as members of
their declared modules rather than repository-wide substrings. Keep implemented and
planned references distinct and preserve the exact plan-mirror check. No deviations
without ADR.

[FAILURE_MODES] Do not make the gate green by ignoring designated root docs,
generated artifacts, missing symbols, or broad classes of planned paths. Exclude
build output and dependencies deliberately, and keep diagnostics stable across line
endings. If current root documentation contradicts PLAN.md, stop with DOC_BLOCKER and
request the smallest reconciliation scope. After three tested parser/validation
approaches fail, record LOGIC_BLOCKER with false-positive/false-negative evidence and
bounded alternatives.
```

#### Ready-to-authorize brief for NEXT_TASK 5.0.5

```text
[SCOPE_CONTRACT] Existing Biome failures under apps/web; formatting-only baseline
failures in apps/server/src/middleware/costGovernor.ts and apps/server/test/load.test.ts;
e2e/smoke.spec.ts plus only the Playwright/Vite/server startup helpers required to
root-cause its late filter-interaction timeout; and
packages/cesium-kit/test/frameBudget.test.ts for the recorded benchmark-title/assertion
mismatch. Out of scope: new product features, visual redesign, provider/runtime
refactors, live services, production deployment, and Phase 5.1 work.

[PERFORMANCE_THRESHOLD] Root lint is green without ignoring files; the canonical smoke
passes within its existing 30-second budget using condition waits only; the Cesium
benchmark title, measurement, and assertion enforce one honest ADR-backed threshold;
uncached affected lint/typecheck/test/build and canonical QA pass; zero live calls.

[ARCHITECTURE_MODE] PLAN.md §2 rules 2, 3, 6, 9, and 13; §3 UI/Cesium boundaries;
§13 acceptance policy; ADRs 0023–0025; and docs/DESIGN.md for every touched UI file.
Preserve provider → store → UI/Cesium flow, the rAF queue, SimClock determinism, and
existing design tokens. No deviations without ADR.

[FAILURE_MODES] Do not raise the smoke timeout, add fixed sleeps, skip lint paths,
weaken a benchmark to match a slow run, or hide a rendering/startup race with retries.
Preserve real-render screenshot evidence. If three measured approaches cannot isolate
the timeout or frame-budget mismatch, record LOGIC_BLOCKER with traces, timing evidence,
and bounded alternatives.
```

### Phase 5.1 — Durable shared governance

- [ ] 5.1.1 Compose one shared runtime context for server, CLI connection mode, MCP transports, and tools; persist budget/STASIS state transactionally.
- [ ] 5.1.2 Consolidate the duplicate tool executors into one validated governance pipeline.
- [ ] 5.1.3 Implement real M2 approval verification after OQ-2; production defaults deny when the gate is unavailable.
- [ ] 5.1.4 Implement M3 ledger reservation/settlement after OQ-3; retries are idempotent and outage behavior is fail closed for billable/mutating work.
- [ ] 5.1.5 Add a versioned hash-chain migration to the SQLite audit WAL, integrity verification, redaction, retention, and corruption tests.
- [ ] 5.1 exit: two-process tests prove shared STASIS; only a human resume clears it; approvals resist replay; audit tampering is detected.

### Phase 5.2 — Provenance and missing geospatial layers

- [ ] 5.2.1 Add required provenance and registry contracts; retrofit existing adapters and UI badges using `SimClock`.
- [ ] 5.2.2 Complete cables: Zod contracts, fixture seed, validated optional pack, server/store/layer/UI, kill switch, health, tests, and license ADR.
- [ ] 5.2.3 Complete satellites after OQ-7: GP/OMM adapter, deterministic fixture, propagation/frame conversion, server/store/layer/UI, kill switch, health, tests, and source ADR.
- [ ] 5.2.4 Generate DATA_SOURCES entries/counts from the registry and label implementation/mode accurately.
- [ ] 5.2 exit: every implemented provider validates and carries provenance; seed mode makes zero network calls; satellite/cable smoke and performance budgets pass.

### Phase 6 — Standards-compliant MCP HTTP

- [ ] 6.1 Write an ADR comparing the official SDK with the existing hand-written server and pin the jointly supported stable protocol.
- [ ] 6.2 Add one `/mcp` Streamable HTTP endpoint with POST/GET, Origin validation, negotiation, sessions, reconnect, limits, and graceful cancellation.
- [ ] 6.3 Apply scoped auth, tenant/capability context, shared governance, and path confinement to every remote tool.
- [ ] 6.4 Correct tool annotations/capabilities; add output schemas and validated structured content; emit only truthful notifications.
- [ ] 6.5 Add protocol, auth, disconnect, replay, STASIS, concurrency, malformed-payload, and inspector/conformance tests.
- [ ] 6 exit: stdio remains compatible; unrelated sessions never receive each other’s messages; remote mutation cannot bypass audit/approval/budget/STASIS.

### Phase 7 — Identity, tenancy, and intelligence routing

- [ ] 7.1 Resolve OQ-4 in an ADR and implement authenticated principal/tenant/role context with resource ownership tests.
- [ ] 7.2 Protect quota-consuming provider/economic calls and add per-tenant rate, cache, budget, and kill-switch policy.
- [ ] 7.3 Add the lazy `/#/intelligence` view and navigation without Cesium; document any new dependency and enforce bundle delta.
- [ ] 7 exit: cross-tenant access tests fail closed; private fields are redacted; direct route/reload works in the chosen hosting model.

### Phase 8 — Economic R0: safe foundation

- [ ] 8.1 Add discriminated geography, estimate, provenance, evidence, and BusinessContext-preview contracts with malicious/limit tests.
- [ ] 8.2 Create a new workspace package for pure economic analysis with no I/O and an explicit source registry; reserve its literal path in the implementing ADR before creation.
- [ ] 8.3 Add licensed deterministic fixtures for ACS, CBP/ZBP, BLS, FEMA, and approved OSM examples; fixtures can never be labeled live.
- [ ] 8.4 Implement a protected, stateless preview API and MCP tool through shared governance.
- [ ] 8.5 Add content/instruction separation and prompt-injection tests before any provider/economic text enters an LLM/Tadpole context.
- [ ] 8 exit: suppressed/unavailable/stale cases validate; provenance is required; no persistence or live calls; ADG and affected gates pass.

### Phase 9 — Economic R1: market and business footprint

- [ ] 9.1 Implement Census ACS using a versioned variable dictionary; retain estimate/MOE/geography/vintage and correct foreign-born definitions.
- [ ] 9.2 Implement CBP/ZBP with disclosure suppression preserved and annual-statistical-estimate wording.
- [ ] 9.3 Add OSM enrichment only after OQ-5, through the sanitizer/pinned-fetch/cache path with attribution and extraction limits.
- [ ] 9.4 Implement deterministic market/competition/location-comparison analysis and evidence bundles.
- [ ] 9.5 Add protected APIs, MCP tools, and the lazy market UI; MapLibre is optional and newly reviewed, never assumed installed.
- [ ] 9 exit: same inputs/config/fixtures yield the same outputs; every claim links to source variables/records; Playwright covers evidence inspection.

### Phase 10 — Economic R2: workforce

- [ ] 10.1 Implement BLS OEWS and LAU adapters respecting registered/unregistered request limits, periods, area codes, suppression, caching, and provenance.
- [ ] 10.2 Add pure workforce analysis, protected API/MCP tools, and UI with “labor-market signal” language.
- [ ] 10 exit: exact BLS series/occupation/area/period identifiers are present; no employee/applicant PII enters the path.

### Phase 11 — Economic R3: risk, resilience, and accessibility

- [ ] 11.1 Verify and implement FEMA NRI and NFHL products from current official service catalogs.
- [ ] 11.2 Implement USGS 3DEP via the current Elevation Point Query Service; do not use the retired `pqs.php` URL.
- [ ] 11.3 Implement EPA AQS as historical/regulatory monitoring data; never label it real-time AQI. Treat AirNow as separate future scope if current conditions are approved.
- [ ] 11.4 Implement approved DOT/BTS accessibility context and pure site-risk functions with provenance and screening disclaimers.
- [ ] 11 exit: source product/vintage/geography is explicit; current alerts and long-term hazards are distinct; no risk result is framed as definitive advice.

### Phase 12 — Tadpole M4 runtime

- [ ] 12.1 Finalize AgentEnvelope mapping, connection lifecycle, identity, and capability propagation after OQ-1.
- [ ] 12.2 Demonstrate M1 observation, M2 signed approval, M3 shared ledger/STASIS, and verified audit chain before M4.
- [ ] 12.3 Run failure drills: invalid signature, replay, ledger timeout, disconnect, budget breach, STASIS notification, and human resume.
- [ ] 12 exit: a real Tadpole agent uses authenticated HTTP MCP; all mutations are governed; spend settles idempotently; audit proof verifies independently.

### Phase 13 — Economic R4: governed SMB digital twin

- [ ] 13.1 Persist versioned BusinessContext only after Phase 7, with migrations, encryption decision, tenant ownership, retention, backup, export, and verified deletion.
- [ ] 13.2 Produce immutable evidence bundles/analysis receipts with source IDs, vintages, variable dictionary, scoring config, code revision, and intent ID.
- [ ] 13.3 Add read-only Tadpole economic tools that still enforce identity, quotas, budget, provenance, and untrusted-content handling.
- [ ] 13.4 Add audited saved watches and bounded notifications; every write records intent/outcome and uses real M2 approval where required.
- [ ] 13 exit: cross-tenant isolation, redaction, deletion, stale/conflicting evidence, and claim-to-source tracing tests pass.

### Phase 14 — Documentation, release, and operational proof

- [ ] 14.1 Reconcile README, DATA_SOURCES, SECURITY, RUNBOOK, DESIGN, API/tool docs, ADR index, environment reference, and generated registry tables.
- [ ] 14.2 Run full uncached lint/typecheck/test/build, ADG, Playwright, performance, load, security, license, MCP conformance, and seed-network-denial gates.
- [ ] 14.3 Produce a reproducible demo scene and rollback/runbook drill without claiming unavailable live integrations.
- [ ] 14 exit: release evidence is linked in §17; no known critical/high finding is open; plan status becomes COMPLETE only after human review.

---

## §11 — INSTANT REJECT ANTI-PATTERNS

Unprotected privileged routes; auth middleware mounted after handlers; direct provider fetch outside `pinned-fetch`; live calls in CI; fixed sleeps in Playwright; component-owned Cesium objects; per-frame rune writes; direct wall-clock use in domain/provider logic; unvalidated type assertions at boundaries; optional “mandatory” provenance; null in number-only schemas; suppressed values coerced to zero; hardcoded provider counts/health; arbitrary remote filesystem paths; separate transport-specific governors; auto-approve or fail-open production fallback; broadcast MCP responses; false `listChanged`; prompt text built from untrusted provider content without isolation; blanket license claims; private tenant data in logs; codenames; unreviewed pushes to `main`.

---

## §12 — ETHICS AND USE LIMITS

Stop and request a human ADR for person tracking, face recognition, de-anonymization, ALPR/IMSI-class capabilities, protected-class inference, individual credit/employment decisions, or surveillance targeting. Economic outputs must not infer sensitive traits, rank individuals, or disguise statistical uncertainty. Use aggregate lawful data, minimum necessary retention, visible provenance, and human decision ownership.

---

## §13 — TESTING AND ACCEPTANCE POLICY

- Canonical entry points: `pnpm gev test`, `pnpm gev qa`, `pnpm gev status`, and affected Turbo tasks. Use underlying commands only when the CLI lacks the command.
- Run affected checks uncached before declaring a gate restored. Full release checks must also be uncached.
- Unit/property tests cover math, propagation, schemas, sanitizers, security, analysis, and hash-chain invariants.
- Provider tests use fixtures and network denial. Boundary tests include malformed, oversized, stale, suppressed, rate-limited, and unavailable responses.
- Playwright uses condition waits only and captures real rendering before visual claims.
- MCP tests cover current protocol behavior and session isolation, not only happy-path JSON-RPC.
- Security tests cover route registration order, authentication configuration, token comparison, path traversal/symlink escape, origin validation, tenant isolation, replay, redaction, and fail-closed outages.
- Performance thresholds must use an existing budget or a numeric ADR based on measured baseline; do not invent a number after implementation.
- A new dependency requires license/security justification and measured bundle/runtime impact.
- ADG success counts only after task 5.0.4 demonstrates that seeded bad paths, symbols, status, versions, and plan drift fail the gate.

---

## §14 — ADR ROADMAP

| ADR | Decision | Status |
|---|---|---|
| 0030 | V3 canonical plan, synchronized named copy, deterministic resume protocol | Accepted |
| 0031 | Authentication, identity, tenancy, and route policy | Reserved |
| 0032 | MCP SDK/transport/protocol/session design | Reserved |
| 0033 | Durable shared governance, M2/M3 adapters, audit hash chain | Reserved |
| 0034 | Satellite source, GP/OMM propagation, reference frames, licensing | Reserved |
| 0035 | Provenance/geography/statistical/evidence contract model | Reserved |
| 0036 | OSM economic use and ODbL output obligations | Reserved |
| 0037 | Intelligence routing and optional MapLibre bundle strategy | Reserved |
| 0038 | Tadpole AgentEnvelope and M4 failure policy | Reserved |
| 0039 | Language placement across TypeScript/Svelte, Rust, SQL, and Python | Accepted |

Reserved ADR numbers are planning aids, not accepted decisions. Update `docs/adr/INDEX.md` only when an ADR file exists.

---

## §15 — PRIMARY RISKS

| Risk | Control |
|---|---|
| Status/checklist claims outrun code | Registry-derived status, meaningful ADG, evidence-only checkboxes |
| Remote MCP enlarges attack surface | Shared governance, scoped auth, origin/size/session limits, path sandbox |
| One process bypasses another’s STASIS | Durable transactional state and multi-process tests |
| Provider/API facts change | Versioned adapters, implementation-time official-source revalidation, fixtures |
| Statistical suppression becomes a false zero | Discriminated estimate contract and tests |
| Licensing contaminates redistribution | Per-source registry, optional packs, ADR/legal review |
| LLM follows hostile provider text | Data/instruction isolation and adversarial tests before exposure |
| Tenant data leaks | Identity-first persistence, row/resource authorization, redaction and isolation tests |
| Cesium/economic UI inflates bundle | Route-level lazy loading and measured budgets |

---

## §16 — OFFICIAL REFERENCES TO REVERIFY AT IMPLEMENTATION

- MCP Streamable HTTP: <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>
- MCP authorization: <https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization>
- MCP tools: <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>
- CelesTrak usage: <https://celestrak.org/usage-policy.php>
- CelesTrak GP formats: <https://celestrak.org/NORAD/documentation/gp-data-formats.php>
- Census API handbook (500 daily queries without a key in the documented policy): <https://www.census.gov/content/dam/Census/library/publications/2020/acs/acs_api_handbook_2020_ch02.pdf>
- ACS variables: <https://api.census.gov/data/2024/acs/acs5/variables.html>
- BLS API limits: <https://www.bls.gov/developers/api_faqs.htm>
- EPA AQS: <https://aqs.epa.gov/aqsweb/documents/data_api.html>
- USGS EPQS: <https://apps.nationalmap.gov/epqs/>
- FEMA NRI services: <https://gis.fema.gov/arcgis/rest/services/NRI>
- OSMF Produced Work guideline: <https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline>

External terms, schemas, quotas, and protocol versions are time-sensitive. The adapter/transport PR must record the date and exact official version rechecked.

---

## §17 — EVIDENCE AND HANDOFF LOG

### V3 creation checkpoint — 2026-08-27

- Scope: planning/documentation only; no implementation code changed.
- Artifacts produced: synchronized `PLAN.md` and `MASTER_PLAN_V3.md`, aligned `AGENTS.md`, ADRs 0030 and 0039, and their ADR index entries.
- Verified: repository status, current CLI status, route order, auth implementation, provider/MCP/governance structure, package manifests, ADR index, V2 assumptions, and quality-gate results from the comparison audit.
- Known pre-existing worktree change: `README.md`; preserve it.
- Baseline: unit/typecheck tasks passed; aggregate gate blocked by web lint; Playwright smoke timed out; ADG passed but is not yet trusted as a completeness proof.
- Next task: **5.0.1 Secure all existing operations routes** using the exact 4-Pillar brief in §10.
- Recommended new-chat instruction: `Resume PLAN.md at NEXT_TASK 5.0.1. Use the embedded 4-Pillar brief exactly; do not advance into later phases.`

### Task 5.0.1 completion checkpoint — 2026-08-27

- Scope completed: operations middleware is registered before every `/ops/*` handler;
  all five registered operations handlers are covered for missing, invalid, and valid
  bearer credentials; unauthorized seed reload is proven not to reach audit intent or
  governance checks; authorized seed reload is proven to make zero outbound calls.
- Files changed for the task: `apps/server/src/index.ts`,
  `apps/server/test/opsAuthRoutes.test.ts`, and the synchronized plan checkpoint pair.
  `apps/server/src/middleware/opsAuth.ts` was inspected but its contract was preserved
  for task 5.0.2. `README.md` was not modified.
- Branch: `codex/secure-ops-routes-5.0.1`. Commit: not created because the working tree
  contains pre-existing uncommitted plan/documentation work that must remain owner-
  controlled. GitHub CLI is unavailable, so open PR inspection and PR creation were
  not possible in this environment.
- Passing evidence: `pnpm --filter @gev/server test -- opsAuthRoutes.test.ts` (20/20),
  `pnpm --filter @gev/server test` (44/44), `pnpm --filter @gev/server typecheck`,
  changed-file Biome check (2 files), `git diff --check`, and
  `pnpm turbo run typecheck test --affected --force` (26/26 tasks),
  `pnpm docs:check`, and the zero-diff synchronized-plan verification.
- Baseline/remaining risk: aggregate `pnpm turbo run lint typecheck test --affected`
  remains blocked by pre-existing formatter failures in server files outside the
  implementation delta (`middleware/costGovernor.ts`, `routes/collab.ts`,
  `middleware/opsAuth.ts`, `test/load.test.ts`) and the already-recorded web lint
  baseline. The changed files pass lint; no out-of-scope formatter rewrite was made.
  STASIS observability remains partial while the server is offline until task 5.1.1.
- Preserved dirty files at handoff: `AGENTS.md`, `README.md`, `docs/adr/INDEX.md`,
  `docs/adr/0030-plan-v3-canonical-resume-and-mirror.md`, and
  `docs/adr/0039-language-placement-and-runtime-boundaries.md`, plus this task's code,
  test, and synchronized plan edits.
- Next task: **5.0.2 Repair authentication consistency**. Its ready-to-authorize
  4-Pillar brief is in §10; it has not been started or authorized by this checkpoint.
- Recommended new-chat instruction: `Resume PLAN.md at NEXT_TASK 5.0.2. Authorize the embedded 4-Pillar brief exactly; do not advance into later tasks.`

### Task 5.0.2 completion checkpoint — 2026-08-27

- Scope completed: one immutable authentication adapter now resolves configuration
  once during server composition and governs operations middleware, voice-session
  provisioning, and privileged collaboration-role assignment. Expected credentials
  are normalized to fixed-length SHA-256 digests before Node timing-safe comparison;
  raw bearer equality and per-route auth environment reads were removed.
- Security behavior: production always requires configured auth even when an opt-out
  is present; configured tokens are enforced in local mode; explicit tokenless local
  seed mode remains allowed but is marked unauthenticated; missing/invalid/unconfigured
  collaboration requests mint viewer-only JWTs, never operator or ai_copilot roles.
- Files changed for task 5.0.2: `apps/server/src/index.ts`,
  `apps/server/src/middleware/opsAuth.ts`, `apps/server/src/routes/voice.ts`,
  `apps/server/src/routes/collab.ts`, `apps/server/test/opsAuth.test.ts`,
  `apps/server/test/voice.test.ts`, `apps/server/test/collab.test.ts`, and the
  synchronized plan checkpoint pair. `README.md` was not modified.
- Branch: `codex/auth-consistency-5.0.2`. Commit: not created because the working tree
  still contains pre-existing uncommitted plan/documentation work that must remain
  owner-controlled. GitHub CLI is unavailable, so PR inspection/creation was not
  possible in this environment.
- Passing evidence: focused auth/operations/voice/collaboration tests (39/39), full
  `@gev/server` tests (56/56), server typecheck, changed-file Biome check (8 files),
  `git diff --check`, property tests for arbitrary equal/unequal token values,
  zero-outbound-call voice and seed tests, and
  `pnpm turbo run typecheck test --affected --force` (26/26 tasks),
  `pnpm docs:check`, and zero-diff synchronized-plan verification.
- Baseline/remaining risk: package-wide server lint is now blocked only by the two
  pre-existing out-of-scope CRLF formatter failures in
  `apps/server/src/middleware/costGovernor.ts` and `apps/server/test/load.test.ts`;
  the already-recorded web lint baseline also remains for task 5.0.5. ADR 0022's
  older voice-auth wording is incomplete and remains documentation reconciliation
  scope for task 5.0.4. STASIS observability remains partial until task 5.1.1.
- Preserved dirty files at handoff: `AGENTS.md`, `README.md`, `docs/adr/INDEX.md`,
  `docs/adr/0030-plan-v3-canonical-resume-and-mirror.md`, and
  `docs/adr/0039-language-placement-and-runtime-boundaries.md`, plus tasks 5.0.1–5.0.2
  code/tests and synchronized plan edits.
- Next task: **5.0.3 Create one provider registry**. Its ready-to-authorize 4-Pillar
  brief is in §10; it has not been started or authorized by this checkpoint.
- Recommended new-chat instruction: `Resume PLAN.md at NEXT_TASK 5.0.3. Authorize the embedded 4-Pillar brief exactly; do not advance into later tasks.`

### Task 5.0.3 completion checkpoint — 2026-08-27

- Scope completed: one validated executable provider registry now owns provider,
  feed, and layer identities; source/license metadata; implementation state; supported
  and selected mode; declared health; and active/registered counts. The seed registry
  reports 10/12 active providers, 10/12 active feeds, and 9/12 active visual layers.
- Honest state: CelesTrak satellites remain planned/unavailable; TeleGeography cables
  remain incomplete/download-pack/unavailable; the implemented Overpass feed is active
  while its incomplete visual layer is not. Seed registry construction performs zero
  outbound calls, and live mode marks seed-only implementations unavailable.
- Consumers completed: `/api/health`, `/api/feeds/health`, `gev status`,
  `gev feeds health`, and MCP `get_feed_health` derive identity, mode, health, and
  counts from the registry. Fabricated per-feed latency, error, TTL, quota, and cached-
  entity claims were removed; unobserved MCP values are returned as null.
- Documentation completed: `DATA_SOURCES.md` points to
  `docs/generated/provider-registry.md`; `pnpm docs:providers` deterministically builds
  that table from `packages/providers/src/registry.ts`; a test proves the committed
  artifact is exact. The obsolete hardcoded default capability manifest was removed.
- Files changed for task 5.0.3: provider-registry contracts/exports and tests under
  `packages/contracts`; registry implementation/exports and tests under
  `packages/providers`; server health composition/routes and tests; CLI status/feed
  commands and tests; MCP feed-health composition and tests; `DATA_SOURCES.md`,
  `docs/generated/provider-registry.md`, `scripts/generate-provider-registry.mjs`,
  `package.json`, and the synchronized plan checkpoint pair. README.md and UI/HUD
  files were not modified.
- Branch: `codex/provider-registry-5.0.3`. Commit not created because the working tree
  retains owner-controlled uncommitted work from the V3 checkpoint and tasks
  5.0.1–5.0.2. GitHub CLI remains unavailable, so open PR inspection and PR creation
  were not possible in this environment.
- Passing evidence: scoped contracts/providers/server/CLI/MCP tests (119/119), scoped
  typecheck and build, changed-file Biome check (19 files), deterministic documentation
  generation, runtime `pnpm gev status` and `pnpm gev feeds health`,
  `pnpm turbo run typecheck test --affected --force --output-logs=errors-only` (26/26
  tasks), `pnpm docs:check`, `git diff --check`, and zero-diff synchronized-plan
  verification. Registry tests cover boundary rejection, duplicate identities,
  mode/state/count derivation, disabled-provider degradation, generated-doc equality,
  and zero network access.
- Remaining risk: `gev status` still carries the older Phase 4 project-phase label;
  phase/status/version claim validation and reconciliation are explicitly task 5.0.4.
  The pre-existing server/web lint baseline remains assigned to task 5.0.5. STASIS
  observability remains partial until task 5.1.1 while the server is offline.
- Next task: **5.0.4 Make ADG meaningful**. Its ready-to-authorize 4-Pillar brief is in
  §10; it has not been started or authorized by this checkpoint.
- Recommended new-chat instruction: `Resume PLAN.md at NEXT_TASK 5.0.4. Authorize the embedded 4-Pillar brief exactly; do not advance into later tasks.`

### Task 5.0.3a completion checkpoint — 2026-08-27

- Scope completed: existing `v1.0.0` and `v1.1.0` history is preserved and labeled
  as early-stage seed/simulation releases rather than maturity evidence. The root
  package manifest is now the sole product-version authority; server health derives
  from it, the unused hardcoded capability manifest was removed, and ADG no longer
  embeds an expected release number.
- Release behavior: release-please remains configured but its workflow is disabled by
  default. A human must set the repository variable `GEV_RELEASES_ENABLED=true` only
  after the documented readiness evidence is recorded; release tags and history were
  not changed.
- Documentation truth: README, SECURITY, VERSION_CONTROL, and CHANGELOG now distinguish
  local seed/demo governance from verified external M2/M3 integration, describe the
  SQLite WAL as non-hash-chained, identify the current MCP/collaboration hardening
  gaps, acknowledge the existing k6 script, and require the build step on a fresh
  clone. The pre-existing README terminology edit was preserved.
- Files changed for task 5.0.3a: `.github/workflows/release.yml`, `CHANGELOG.md`,
  `README.md`, `SECURITY.md`, `VERSION_CONTROL.md`, `apps/server/src/index.ts`,
  `apps/server/src/productVersion.ts`, `apps/server/test/productVersion.test.ts`,
  `packages/contracts/src/capabilities.ts`, `scripts/adg.mjs`, and this synchronized
  plan checkpoint pair.
- Branch: `codex/adg-5.0.4`. Commit not created because the working tree remains an
  owner-controlled pre-5.0.4 remediation workspace. GitHub CLI is unavailable, so
  open PR inspection and PR creation were not possible in this environment.
- Passing evidence: contracts tests (24/24), server tests (66/66), focused contracts
  and server typechecks, changed-code Biome check (5 files), `pnpm docs:check`
  (38 documents, 237 path references, 102 symbol references), `git diff --check`,
  and zero-diff synchronized-plan verification. Tests prove runtime/root version
  equality and reject malformed manifest versions; all work stayed local with zero
  live-service calls.
- Remaining risk: the current ADG still counts rather than validates many inline
  symbols and does not yet enforce designated-root-document or phase/status claim
  truth. Those are intentionally retained for task 5.0.4. MCP truth/filesystem and
  server/collaboration trust-boundary findings are now explicit prerequisite tasks.
- Next task: **5.0.3b Make local MCP truthful and confine scene files**. Its exact
  ready-to-authorize 4-Pillar brief is in §10; no task 5.0.3b code has been started.
- Recommended new-chat instruction: `Resume PLAN.md at NEXT_TASK 5.0.3b. Authorize the embedded 4-Pillar brief exactly; do not advance into later tasks.`

### Task 5.0.3b completion checkpoint — 2026-08-27

- Capability truth: the default stdio `tools/list` now exposes exactly seven tools
  backed by the local operator context or verified evidence. `fly_to_location`,
  `toggle_layer`, `select_entity`, `inspect_telemetry`, `query_aoi`, and
  `set_sim_time` remain available to real browser executors through the shared
  contracts registry but are neither advertised nor executable through stdio; direct
  calls fail before audit or action.
- Scene confinement: the operator context owns a real validated `SceneState` and a
  canonical scene root (`.gev/scenes`, configurable with `GEV_MCP_SCENE_ROOT`). Scene
  paths accept one root-level `.json` filename only, reject absolute/drive/UNC/
  traversal/directory/alternate-stream forms and symbolic links, enforce a 1 MiB byte
  limit, and save through a same-root exclusive temporary file plus atomic rename.
  Failed writes remove the temporary file.
- Scene truth: load updates the local context state; save serializes that current state.
  The fabricated entity count was removed. Load/save summaries now contain only scene
  version, layer counts, AOI count, camera altitude, and selected entity values derived
  from the validated scene contract. Exactly one inline payload or filename is required
  for load, and save requires a filename.
- Diagnostics and demo truth: the audit diagnostic passes only after a SQLite query
  succeeds and reports failure without crashing when it does not; fixture diagnostics
  verify readable regular files. `gev demo` now uses real local kill-switch mutations
  and labels the workflow, generated Ed25519 key, human resume, and disconnected hash
  helper explicitly as a local seed simulation rather than external M2/M3 proof.
- Files changed for task 5.0.3b: `packages/contracts/src/tools.ts`,
  `packages/contracts/test/contracts.test.ts`, `packages/ops-mcp/src/server.ts`,
  `packages/ops-mcp/src/tools.ts`, `packages/ops-mcp/test/mcp.test.ts`,
  `packages/ops-mcp/test/sceneSecurity.test.ts`,
  `packages/cli/src/commands/demo.ts`, `packages/cli/test/demo.test.ts`, the focused
  README/SECURITY truth corrections required by the completed hardening, and this
  synchronized plan checkpoint pair.
- Passing evidence: contracts tests (24/24), MCP tests (28/28), CLI tests (7/7),
  focused typechecks/builds, changed-file Biome, affected workspace typecheck/test
  (26/26 tasks), documentation guard, `git diff --check`, and byte-identical plan
  verification. Adversarial coverage includes all six unsupported direct calls,
  Windows/POSIX traversal, absolute/UNC/drive/alternate-stream forms, symlink escape
  where supported, oversized file and multibyte inline input, atomic replacement,
  failed-rename cleanup, audit ordering, failed diagnostics, and zero live calls.
- Branch: `codex/adg-5.0.4`. Commit not created because this remains an
  owner-controlled pre-5.0.4 remediation workspace. GitHub CLI is unavailable, so PR
  inspection and creation were not possible in this environment.
- Remaining boundary: these guarantees cover the local stdio transport. A future
  network MCP endpoint must reuse the same capability filter, context, confinement,
  audit, approval, and budget path; it is explicitly outside this task.
- Next task: **5.0.3c Repair current server and collaboration trust boundaries**. Its
  exact ready-to-authorize 4-Pillar brief is in §10; no task 5.0.3c code has started.
- Recommended new-chat instruction: `Resume PLAN.md at NEXT_TASK 5.0.3c. Authorize the embedded 4-Pillar brief exactly; do not advance into later tasks.`

### Task 5.0.3c completion checkpoint — 2026-08-27

- Authenticated identity is now authoritative: audit intent actors come only from the
  shared operations-auth decision, caller-supplied `X-Actor` is ignored, local seed is
  represented as `system`, and STASIS resume requires an authenticated human even when
  no lock is active. The duplicate operations-auth registration was removed.
- Collaboration transport boundaries now reject missing or malformed Origins and compare
  parsed hosts exactly, bind the URL room to the verified JWT room, validate complete JWT
  payloads against the shared contract, inject the simulation clock, and protect room
  enumeration/detail behind operations auth. Public health no longer exposes room IDs.
- Join responses contract-validate the assigned role and server-issued `clientId`.
  Presence accepts only bounded cursor/camera/selection patches while callsign, role,
  color, client ID, and last-seen time remain server-owned. The web store validates join
  and presence payloads, removes self-presence before rendering, and prevents self-follow.
- Authorized CRDT updates are applied first to an isolated clone and schema-validated
  before live commit. Invalid updates close the peer without mutating or broadcasting
  room state. A shared remote-origin marker prevents browser echo of server updates.
- One clock-injected in-memory limiter instance is shared across transports and enforces
  per-client fixed-minute caps of 5 voice sessions, 20 collaboration joins, and 20
  WebSocket upgrades. Tests inject client identity and time; no new auth environment
  contract or transport-specific governor was added.
- Files changed for task 5.0.3c: `apps/server/src/index.ts`,
  `apps/server/src/middleware/opsAuth.ts`, `apps/server/src/routes/collab.ts`,
  `apps/server/src/routes/voice.ts`, focused server tests,
  `packages/contracts/src/collab.ts`, `packages/core/src/collabDoc.ts`,
  `packages/core/test/collabDoc.test.ts`, `apps/web/src/stores/collab.svelte.ts`,
  `apps/web/src/components/CollabBar.svelte`, and this synchronized checkpoint pair.
- Passing evidence: the full monorepo build/lint/typecheck/test gate completed 40/40
  tasks; contracts 24/24, core 39/39, server 75/75, MCP 28/28, CLI 7/7, security
  34/34, providers 24/24, governance 9/9, and Cesium 12/12 tests passed. Focused
  adversarial tests cover actor spoofing, human-only resume, exact/missing Origin,
  room-token binding, role downgrade, protected room reads, staged CRDT poisoning,
  remote-origin echo suppression, self-presence removal, all three abuse limits, clock
  reset, and zero live calls. ADG passed across 38 documents, 254 paths, and 104 symbol
  references; bundle budgets and byte-identical plan verification passed.
- Browser evidence: the unchanged canonical 30-second Playwright smoke reproduced its
  pre-existing late filter-interaction timeout twice. A diagnostic run with only the
  timeout raised to 90 seconds passed in 36.6 seconds and produced the expected rendered
  screenshot. No e2e source was changed; restoring the mandatory 30-second baseline by
  root cause remains explicitly assigned to task 5.0.5.
- Additional task 5.0.5 baseline evidence: the Cesium ingestion benchmark is titled
  `< 16.6ms p95` but currently asserts only `< 250ms`; the full gate printed 42.63ms p95
  and passed. This pre-existing test-claim mismatch was not changed in task 5.0.3c.
- Branch: `codex/adg-5.0.4`. Commit not created because this remains an
  owner-controlled pre-5.0.4 remediation workspace. GitHub CLI is unavailable, so PR
  inspection and creation were not possible in this environment.
- Next task: **5.0.4 Make ADG meaningful**. Its exact ready-to-authorize 4-Pillar brief
  is in §10; no task 5.0.4 code has started or been authorized by this checkpoint.
- Recommended new-chat instruction: `Resume PLAN.md at NEXT_TASK 5.0.4. Authorize the embedded 4-Pillar brief exactly; do not advance into later tasks.`

### Task 5.0.4 completion checkpoint — 2026-08-28

- Scope completed: ADG now validates every designated root Markdown file plus
  `docs/**/*.md`; resolves implemented paths relative to the source document and
  workspace root; confines source lookup to declared modules; follows TypeScript/
  JavaScript re-exports; and validates only module-qualified symbol claims rather than
  counting repository-wide substrings.
- Planned-versus-implemented behavior: a missing concrete future path passes only when
  the same line carries the exact `adg:planned-path <path>` marker. Mismatched, wildcard,
  template, traversal, stale, and non-workspace markers fail. Template examples remain a
  separate prefix-validated category; build output and dependencies are excluded.
- Claim integrity: ADG enforces byte-identical PLAN.md/MASTER_PLAN_V3.md, checkpoint-to-
  first-unchecked-task consistency, plan metadata/status/current phase, README and
  SECURITY current-phase claims, root package/CHANGELOG version agreement, designated
  root-document presence, and the CLI's declared project phase.
- CLI reconciliation: console and JSON status now share one `PROJECT_PHASE` declaration,
  report `Phase 5.0 — Safety and Source-of-Truth Bootstrap`, and are guarded against
  future PLAN.md drift. The narrow CLI scope amendment was explicitly developer-authorized.
- Files changed for task 5.0.4: `package.json`, `scripts/adg.mjs`,
  `scripts/adg.test.mjs`, `scripts/lib/adg-core.mjs`,
  `scripts/lib/adg-claims.mjs`, `packages/cli/src/commands/status.ts`,
  `packages/cli/test/cli.test.ts`, and this synchronized checkpoint pair.
- Passing evidence: focused ADG adversarial tests (11/11), real `pnpm docs:check`
  across 46 documents/356 paths/19 module-qualified symbols, focused CLI tests (7/7),
  CLI typecheck/build and runtime `pnpm gev status`, changed-file Biome check,
  `git diff --check`, and uncached affected workspace typecheck/test (26/26 tasks).
  Seeded cases prove deterministic failure for missing paths, wrong-module symbols,
  stale README and CLI phases, impossible task status, stale product version, plan-copy
  drift, missing designated docs, broad planned-path markers, and CRLF line evidence.
- Runtime status remained offline with `STASIS_INACTIVE`; per §0 this is partial
  observability only. All work stayed local/seed with zero live-service calls.
- Branch: `codex/adg-5.0.4`; implementation commit `b05a19e`. GitHub CLI remains
  unavailable, so open PR inspection and PR creation were not possible in this environment.
- Next task: **5.0.5 Restore the quality baseline**. Its exact ready-to-authorize
  4-Pillar brief is in §10; no task 5.0.5 implementation has started or been authorized.
- Recommended new-chat instruction: `Resume PLAN.md at NEXT_TASK 5.0.5. Authorize the embedded 4-Pillar brief exactly; do not advance into later tasks.`

No later task is authorized merely because it appears in this plan.
