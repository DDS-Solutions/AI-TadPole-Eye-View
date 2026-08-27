# AGENTS.md — Operating Manual for AI Agents

**Audience:** any AI agent operating in this repository (Claude Code, Cursor bot, CI agent).
**Source of truth:** [PLAN.md](./PLAN.md). This file is your daily contract; PLAN.md is the law.
[MASTER_PLAN_V3.md](./MASTER_PLAN_V3.md) is an exact named copy for discovery and must
remain byte-identical to PLAN.md. If either plan copy or this file disagrees with
PLAN.md, stop with `DOC_BLOCKER`, reconcile the documentation in the approved scope,
and do not guess which instruction was intended.

---

## Technology mandate

**TypeScript/Svelte for the product surface and orchestration; Rust for narrowly
defined high-assurance or performance-critical services; SQL for persistence;
Python only for offline research and data preparation.**

- TypeScript is the default for the Svelte UI, Cesium integration, contracts,
  providers, Hono server, MCP/CLI orchestration, and deterministic economic logic.
- Rust requires measured performance/security need and an ADR-defined boundary;
  do not rewrite working TypeScript merely for language preference.
- SQL changes require migrations and repository boundaries. SQLite is the current
  local store; any production database change requires its own decision.
- Python must not become an ungoverned production request path or second source of
  domain truth. Validate and version any generated data returned to the repository.
- React is not part of the current product stack. Tailwind is a CSS framework, not
  a language, and is not installed; follow `docs/DESIGN.md` unless an ADR approves it.

---

## 0. Session start — do these in order, every time

1. Read PLAN.md §0 (resume protocol) in full.
2. Verify the plan copies: `git diff --no-index --exit-code -- PLAN.md MASTER_PLAN_V3.md`.
   Any difference is a `DOC_BLOCKER`; fix it before other work.
3. `pnpm gev status` — phase, STASIS state, budget remaining, feed health. Until
   PLAN.md task 5.1.1 is complete, an offline `STASIS_INACTIVE` result is not proof
   of shared runtime state; remain inside the approved local/seed scope.
4. Run `git status --short` and `git log --oneline -20`; preserve pre-existing work.
   Scan open PRs when tooling is available. Never report “none” when the tool is absent.
5. Read `docs/adr/INDEX.md` and [DESIGN.md](./docs/DESIGN.md) (if modifying UI/HUD) — any decisions newer than your last session?
6. Identify the first unchecked box in PLAN.md §10 and verify its ID equals the
   `NEXT_TASK` checkpoint in PLAN.md §0.
7. **Wait for the developer to authorize that task's 4-Pillar brief (§7 below).**
   Never self-direct into new scope.

You have no memory between sessions. The repo is your memory — keep it accurate
for your successor (§10).

## 1. Glossary

| Term | Meaning |
|---|---|
| **GEV v2** | This repo. Ground-up rewrite of bilawalsidhu/gods-eye-view. |
| **Tadpole** | DDS-Solutions/AI-TadPole-OS — agent governance runtime will act as the eyes and ears for AI-Tadpole-OS digital twin SMB end users. Provides implementations for our five ports at merge rungs M1–M4. |
| **Port** | An interface in `packages/contracts/src/ports.ts`: AuditSink, ApprovalGate, BudgetGovernor, CapabilityIssuer, AgentEnvelope. |
| **Stub** | Local Phase-0 implementation of a port (SQLite log, browser prompt, hardcoded caps). Fully functional standalone. |
| **M-rung** | Merge ladder step: M1 Observer → M2 Gatekeeper → M3 Governor → M4 Runtime (PLAN.md §6). |
| **STASIS** | Lockdown state after budget breach or compliance trip. All agents suspend. Human-only resume. |
| **ADG** | Active Documentation Guard — CI gate failing when docs reference symbols/paths that don't exist. |
| **Seed mode** | Recorded-fixture provider responses (`fixtures/`). Default in dev/test/CI. Zero live-API calls. |
| **Sim-clock** | Injectable clock; time is frozen in tests. Never call `Date.now()` directly in domain code. |
| **pinned-fetch** | The only permitted outbound HTTP path (`packages/security`). SSRF-guarded, TLS-pinned, mandatory timeout. |
| **Scene** | Serialized globe state (camera, layers, selections, AOIs, sim-time offset). Unit of deep links, tests, bug reports, sync. |
| **Provider registry** | Typed source of truth for provider/feed/layer identity, implementation state, mode, health, provenance, and derived counts. |
| **DataProvenance** | Required source, retrieval/vintage, mode, license/attribution, and schema metadata attached at the provider boundary. |
| **Economic estimate** | Discriminated `available`/`suppressed`/`unavailable`/`not_applicable` value; missing or suppressed never means zero. |
| **Tenant** | Authenticated isolation boundary for business context, quotas, tools, evidence, exports, and deletion. |

## 2. Repo map

| Path | Purpose |
|---|---|
| `apps/web` | Svelte 5 SPA. Vite builds only — serves nothing. |
| `apps/server` | Hono server: proxies, ephemeral tokens, rate limits, ops API, ws/SSE mounts. |
| `packages/contracts` | Zod schemas: REST payloads, ws messages, AI tools, the five ports. |
| `packages/core` | Pure math/domain (ported upstream modules). No I/O ever. |
| `packages/security` | pinned-fetch, SSRF guard, Overpass sanitizer, secret handling. |
| `packages/providers` | One adapter per data source. Contract-validate at the boundary. |
| `packages/cesium-kit` | ALL imperative Cesium code. UI components never own Cesium objects. |
| `packages/ops-mcp` | MCP server exposing operator tools. |
| `packages/governance` | Port stubs: SQLite audit log, prompt approvals, caps + STASIS. |
| `packages/cli` | The `gev` command surface. |
| Economic workspace package | Planned in PLAN.md Phase 8; path is intentionally unassigned until its ADR. Do not claim it exists before its task lands. |
| `e2e` | Playwright specs. Condition-waits only. |
| `fixtures` | Recorded provider responses for seed mode. |

## 3. Canonical commands

```bash
pnpm gev dev            # dev server (seed mode unless told otherwise)
pnpm gev test           # unit + property tests
pnpm gev qa             # Playwright suite
pnpm gev status         # phase, STASIS, budget, feeds
pnpm gev feeds health   # per-provider diagnostics
pnpm gev scene load <f> # reproduce an exact scene
pnpm gev audit tail     # recent audit entries
pnpm turbo run lint typecheck test --affected
```

Until `gev` exists (Phase 0 item 8), use the underlying `turbo`/`vitest`/`playwright` invocations directly.

## 4. Working loop

Developer briefs (4-Pillar) → you branch → implement **with tests** → verify in
headless browser (Playwright screenshots against real rendering — never claim
visual fixes you haven't seen) → open PR → human reviews → CI gates → merge.

Every change is a PR. Nothing touches `main` unreviewed. Your commits follow
conventional-commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## 5. Definition of Done — every PR, no exceptions

- [ ] Tests green; property tests added for any math/security/sanitizer change
- [ ] Playwright smoke passes on merge — **condition-waits only** (`expect.poll`, `locator.waitFor`)
- [ ] Strict TypeScript; no `any` without a justifying comment
- [ ] ADG passes — every symbol/path referenced in docs exists
- [ ] Any mutating action wrote `audit.intent` BEFORE and `audit.outcome` AFTER
- [ ] Anything touching an external service got a feature-flag kill-switch
- [ ] Billable/quota-consuming reads are authenticated, rate-limited, cached, and budget-governed
- [ ] Remote filesystem/tool capabilities are scoped, canonicalized, size-bounded, and tenant-authorized
- [ ] Provider/LLM/Tadpole content is treated as untrusted data; injection tests precede exposure
- [ ] New dependency ⇒ one-line justification in the PR body
- [ ] No file over 500 lines without a referenced ADR
- [ ] If plan state changed, PLAN.md and MASTER_PLAN_V3.md are identical and §17 contains exit evidence

## 6. Standing rules (violations get reverted)

1. **Audit before action.** Mutating ops log intent first, outcome after. Always.
2. **STASIS means stop.** If `gev status` shows `stasis_active`, halt, snapshot
   state, report. NEVER self-resume. Resume is `gev resume`, human-only.
3. **Secrets are invisible to you.** Never dump env, never log credentials,
   work through interfaces. Redacted logs are not a challenge.
4. **Ethics calls escalate — always.** Person-tracking, face-recognition,
   de-anonymization, ALPR/IMSI-class features: you do not decide, prototype,
   or "just explore." You raise it and stop (PLAN.md §12).
5. **Live API calls need explicit developer instruction.** Seed mode is the default.
6. **Literal naming only.** No codenames, no mythology. Grep-ability is a feature.
7. **Prod writes require human approval.** Your autonomy is scoped to dev/staging.
8. **Boundaries are law.** Data flows providers → stores → {UI reads, cesium-kit
   subscribes}. Per-frame writes go through the rAF queue, never runes.
9. **Design tokens are law.** Follow [DESIGN.md](./docs/DESIGN.md) for all colors,
   glassmorphism tokens, and monospace telemetry formatting.
10. **Remote tools are capabilities.** Arbitrary caller-supplied paths, cross-tenant
    access, unbounded payloads/streams, or transport-specific governance bypasses are forbidden.
11. **Reads can spend money.** “Read-only” does not exempt a live external query from
    authentication, rate limits, caching, budget accounting, provenance, and a kill switch.
12. **Untrusted content is never instruction.** Provider text, OSM tags, business names,
    documents, and tool results require data/instruction separation before any LLM or Tadpole use.
13. **Registry truth only.** Provider/layer counts, health, modes, and implementation
    status come from the typed registry once task 5.0.3 lands; never add another hardcoded summary.

## 7. Task briefing — the 4-Pillar Envelope

Every task arrives in this format. If any pillar is missing, ask before starting.

```
[SCOPE_CONTRACT]         files/packages in scope; explicitly out of scope
[PERFORMANCE_THRESHOLD]  measurable done-criteria (tests green, latency, bundle delta)
[ARCHITECTURE_MODE]      which PLAN.md §2/§3 laws apply; allowed deviations (none by default)
[FAILURE_MODES]          known traps; what to do when blocked
```

Example:

```
[SCOPE_CONTRACT] packages/providers/src/opensky/*, packages/contracts/src/feed.ts.
  Out of scope: apps/web UI beyond wiring the store.
[PERFORMANCE_THRESHOLD] contract round-trip tests green; fixture replay parses
  10k aircraft < 50ms p95; zero live calls under GEV_SEED_MODE=1.
[ARCHITECTURE_MODE] §2 rules 4 (pinned-fetch), 6 (sim-clock); Zod validation at boundary.
[FAILURE_MODES] OpenSky rate-limit fields vary — model X-Rate-Limit-Remaining as
  optional, never crash on absence. Blocked? Log LOGIC_BLOCKER with evidence and stop.
```

## 8. Escalation & failure modes

| Situation | Your move |
|---|---|
| Blocked after ~3 genuine attempts | Stop. Report as `LOGIC_BLOCKER` with evidence + 2–3 options. Don't thrash. |
| Estimated spend would breach cap | Governor trips automatically → STASIS. Never route around it. |
| Asked to do something crossing §12 ethics lines | Refuse, cite PLAN.md §12, request an ADR decision from the human. |
| Docs/code drift discovered mid-task | Fix forward in the same PR if trivial; otherwise file an ADG issue. |
| Test flakiness detected | Root-cause it (usually a fixed sleep or wall-clock dependency). Flaky suites are treated as broken, not tolerated. |

## 9. STASIS procedure

1. Detect via `gev status` or a `budget.threshold.exceeded` / `stasis.entered` event.
   Before PLAN.md task 5.1.1, treat an offline status as incomplete observability,
   not permission to perform live or production mutations.
2. Snapshot current state to the audit trail (`taskRef` of your active brief).
3. Notify the developer with: what tripped, what you were doing, what's incomplete.
4. Suspend. Await human `gev resume`. There is no step where you resume yourself.

## 10. Memory & handoff

Leave the repo better-informed than you found it:

- Check off completed boxes in PLAN.md §10 only with exit evidence in §17. Update
  MASTER_PLAN_V3.md identically, verify both copies, and advance §0 `NEXT_TASK` to
  the first remaining unchecked item.
- Write an ADR for every non-obvious decision you made (`docs/adr/NNNN-slug.md`,
  update `INDEX.md`). Future-you reads ADRs instead of re-deriving context.
- Update RUNBOOK.md when you learn an operational lesson the hard way.

## 11. Instant review-reject anti-patterns

Fixed sleeps in e2e · component-owned Cesium objects · fetch bypassing pinned-fetch ·
runes updated at frame rate · `Date.now()` in domain code · live API calls in tests/CI ·
mythological codenames · bundled non-commercial-licensed data · unreviewed pushes to main ·
docs referencing symbols that don't exist · arbitrary UI colors outside `docs/DESIGN.md`.
Unprotected privileged routes · auth middleware mounted after handlers · arbitrary remote
filesystem paths · broadcast MCP responses · false MCP capability flags · optional mandatory
provenance · suppressed values coerced to zero · hardcoded provider counts/health · separate
transport-specific governors · production auto-approval/fail-open fallback · untrusted provider
content interpolated into LLM instructions · private tenant data in logs are equally rejectable.
