# 4-Pillar Task Briefing Envelope

> **Operating Standard for GEV v2 & AI-TadPole-OS Agent Directives**  
> **Source of Truth:** [AGENTS.md](./AGENTS.md#L104-L126) §7 · [PLAN.md](./PLAN.md#L223-L230) §7.6

Every developer task issued to an autonomous AI agent in this repository must arrive packaged within the **4-Pillar Envelope**. If any pillar is missing or ambiguous, the agent is required to halt and request clarification before executing mutating work.

---

## 1. The Four Pillars

```
┌────────────────────────────────────────────────────────────────────────┐
│                        4-PILLAR TASK ENVELOPE                          │
├─────────────────────────┬──────────────────────────────────────────────┤
│ [SCOPE_CONTRACT]        │ In-scope files/packages & out-of-scope seams │
│ [PERFORMANCE_THRESHOLD] │ Measurable done-criteria, tests & budgets    │
│ [ARCHITECTURE_MODE]     │ Invariant rules (PLAN.md §2/§3), zero-bypass │
│ [FAILURE_MODES]         │ Known traps, rate-limits & LOGIC_BLOCKER flow│
└─────────────────────────┴──────────────────────────────────────────────┘
```

### Pillar I: `[SCOPE_CONTRACT]`
- **Target Boundaries:** Exact file paths, packages (`packages/*`, `apps/*`), or submodules allowed to be modified or created.
- **Explicit Exclusions:** What the agent MUST NOT touch (e.g., UI layout when implementing provider logic, Cesium imperative objects directly from Svelte components, or changing unrelated contracts).
- **Interface Seams:** Required contract/Zod schema alignment or port bindings.

### Pillar II: `[PERFORMANCE_THRESHOLD]`
- **Verification Gates:** Specific test suites (`vitest`, `playwright`, property tests with `fast-check`) that must pass.
- **Latency & Ingestion Criteria:** Parsing speed, query execution time, or frame budget compliance (<16.6ms / 60 FPS).
- **Bundle & Memory Constraints:** Bundle size delta limits, heap constraints, or zero-live-API call enforcement (`GEV_SEED_MODE=1`).

### Pillar III: `[ARCHITECTURE_MODE]`
- **Non-Negotiable Laws:** Strict adherence to [PLAN.md §2](./PLAN.md#L48-L58) / [§3](./PLAN.md#L61-L128) (e.g., Rule 1 boundaries, Rule 4 `security/pinned-fetch` with mandatory timeouts, Rule 5 rAF entity queue bypassing runes, Rule 6 sim-clock determinism).
- **Allowed Deviations:** Explicit exceptions approved by the human operator (defaults to *None*).
- **Audit & Governance:** Mandatory WAL entry logging (`audit.intent` before mutation, `audit.outcome` after mutation).

### Pillar IV: `[FAILURE_MODES]`
- **Known Traps & Edge Cases:** Upstream idiosyncrasies (e.g., variable rate-limit headers, optional fields, malformed coordinates, schema drift).
- **Circuit Breaker & Escalation:** Immediate escalation policy. If blocked after ~3 attempts or encountering an ethical/budget boundary, stop and report `LOGIC_BLOCKER` with evidence and options.

---

## 2. Blank Copy-Paste Template

```markdown
[SCOPE_CONTRACT]
- In-Scope: <packages/...>, <apps/...>, <specific files>
- Out-of-Scope: <explicitly excluded files, components, or layers>
- Contract / Seam: <Zod schemas, ports, or API contracts>

[PERFORMANCE_THRESHOLD]
- Test Suite: <vitest / fast-check / playwright test requirements>
- Latency / Throughput: <e.g., parse 10k entities in < 50ms p95>
- Environment: <GEV_SEED_MODE=1, zero live-network calls during CI>
- Bundle Budget: <e.g., chunk delta < 5KB gzip>

[ARCHITECTURE_MODE]
- Laws Applied: PLAN.md §2 (Rules 1, 4, 5, 6), §3 (One-way data flow)
- Network: All outbound HTTP through @gev/security pinned-fetch
- Governance: Write-Ahead Log (audit.intent / audit.outcome) required for mutating ops
- Deviations: None

[FAILURE_MODES]
- Upstream Traps: <known provider quirks, missing headers, flaky endpoints>
- Fallback: <deterministic fixture replay, cache-stale fallback, flag kill-switch>
- Escalation: On 3rd failure or unexpected schema breach, log LOGIC_BLOCKER and halt.
```

---

## 3. Real-World Task Briefing Examples

### Example A: Data Provider Adapter Task
```markdown
[SCOPE_CONTRACT]
- In-Scope: packages/providers/src/opensky/*, packages/contracts/src/feed.ts
- Out-of-Scope: apps/web UI beyond wiring the telemetry store
- Contract: Zod schema for FlightStateArray and ProviderHealth

[PERFORMANCE_THRESHOLD]
- Contract round-trip tests green with fast-check fuzzing
- Fixture replay parses 10k aircraft state vectors in < 50ms p95
- Zero live network calls under GEV_SEED_MODE=1

[ARCHITECTURE_MODE]
- PLAN.md §2 Rule 4 (SSRF-guarded pinned-fetch with 5s timeout)
- PLAN.md §2 Rule 6 (sim-clock timestamp injection, no direct Date.now())
- Zod validation enforced at the network boundary

[FAILURE_MODES]
- OpenSky rate-limit headers vary across anonymous vs authenticated tiers; model X-Rate-Limit-Remaining as optional, never throw on absence.
- Blocked? Log LOGIC_BLOCKER with raw response snapshot and wait.
```

### Example B: Tactical HUD Component Task
```markdown
[SCOPE_CONTRACT]
- In-Scope: apps/web/src/lib/components/hud/*, apps/web/src/lib/stores/telemetry.svelte.ts
- Out-of-Scope: packages/cesium-kit internals and server routes
- Contract: Render telemetry feeds conforming to docs/DESIGN.md design tokens

[PERFORMANCE_THRESHOLD]
- Playwright smoke specs green using condition-based assertions (expect.poll)
- Virtualized list handles 5,000 active tracks without dropping frames (>58 FPS)
- Bundle delta < 15KB gzip

[ARCHITECTURE_MODE]
- PLAN.md §2 Rule 1 (UI never owns Cesium objects; reads reactive Svelte 5 runes only)
- docs/DESIGN.md token compliance (glassmorphism panel styles, monospace telemetry)
- Deviations: None

[FAILURE_MODES]
- Track list re-renders causing layout thrashing; enforce TanStack virtual scrolling with fixed row heights.
- Never use fixed setTimeout/sleep in UI tests.
```

### Example C: Governance Port / Security Task
```markdown
[SCOPE_CONTRACT]
- In-Scope: packages/governance/src/ports/*, packages/security/src/pinned-fetch.ts
- Out-of-Scope: Third-party auth providers or web UI
- Contract: Implement CapabilityIssuer and AuditSink port interfaces

[PERFORMANCE_THRESHOLD]
- 100% unit test coverage; property tests for IPv4/IPv6 CIDR validation
- Merkle audit log append latency < 2ms per transaction
- Zero secret leakage in structured JSON logs

[ARCHITECTURE_MODE]
- PLAN.md §5 (Strict threat model: localhost binding, redirect rejection, non-global IP blocklist)
- Tamper-evident hash chaining on SQLite WAL
- Deviations: None

[FAILURE_MODES]
- Node.js DNS lookup returning multiple IP records; validate all A and AAAA records prior to TLS handshake.
- Budget tripwire must enter STASIS_ACTIVE and refuse auto-resume.
```
