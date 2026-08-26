# GEV v2 — Master Build Plan

**Project:** God's Eye View v2 — agent-native OSINT console
**Org:** DDS-Solutions · **Status:** Pre-scaffold · **Plan version:** 1.0 (2026-08)
**Upstream reference:** `bilawalsidhu/gods-eye-view` (~2k stars) · Our fork: `DDS-Solutions/gods-eye-view` (zero-diff snapshot of commit `880a672`)
**Companion project:** `DDS-Solutions/AI-TadPole-OS` (agent governance runtime — merges in later via defined seams)

---

## §0 — RESUME PROTOCOL (read this first if you are the AI)

You have no memory between sessions. This plan is your memory. On session start:

1. Read this entire file.
2. Read `AGENTS.md` (operating manual — see §7.5).
3. Run `pnpm gev status` → confirms current phase, STASIS state, budget remaining, feed health.
4. Read `docs/adr/INDEX.md` (decision log) — especially any ADR newer than your last session.
5. `git log --oneline -20` and review open PRs.
6. Find the first unchecked box in §10 and confirm it with the developer.
7. **Wait for the developer to issue the task** using the 4-Pillar Envelope (§7.6). Do not self-direct into new work.

**Standing rules:** nothing touches `main` unreviewed. All work happens on branches as PRs. Every mutating action you take is logged to the AuditSink (`audit.intent` / `audit.outcome`). If `STASIS_ACTIVE`, stop and report — never self-resume. Ethical judgment calls (§12) are always escalated to the human.

---

## §1 — MISSION & CONTEXT

### 1.1 What we're building
A ground-up rewrite of God's Eye View: a CesiumJS-based OSINT console rendering live global data (flights, ships, satellites, earthquakes, fires, public CCTV, radio, launch replays) with an AI voice-agent copilot — rebuilt as a typed monorepo designed from day one for **AI co-development and AI co-operation**: an AI agent (me) builds, operates, monitors, debugs, and eventually sits beside the end user in the same app as a governed co-user.

### 1.2 Why rewrite instead of fork-and-patch
Upstream's disease is missing boundaries, not bad code: `src/ui.js` = 455 KB, `vite.config.js` = 322 KB (entire backend lives inside build config), `style.css` = 247 KB, `index.html` = 53 KB, `cctv.js` = 198 KB. Package boundaries are context-window-sized reasoning units — a codebase of ~30 small packages is one an AI can fully load, verify, and modify safely. Retrofitting boundaries into those files costs more than rebuilding.

### 1.3 What we keep from upstream (port these — they're assets)
- **Pure modules, nearly verbatim:** cockpitMath, scopeMask, geo math, SGP4 wrappers (satellite.js + egm96-universal geoid correction + mgrs).
- **SSRF-guarded fetcher:** self-resolved DNS, validation of every A/AAAA record against non-global ranges (IPv4 + IPv6 CIDR math; allow only `2000::/3`; exclude Teredo `2001::/23`, 6to4 `2002::/16`, doc ranges), TLS pinned to validated address via custom undici `lookup` hook, redirects refused, path allowlists, byte caps.
- **OverpassQL sanitizer:** single-pass lexer blanking quoted literals + comments together, tag-filter stripping before spatial-bounds probing, set-provenance tracking, `poly:` and control-flow rejection, `[timeout:]` clamps, radius/bbox/body/response/concurrency caps.
- **Cost governor:** adaptive cache TTL tiers keyed on `X-Rate-Limit-Remaining` (9s → 30s → 90s → 300s as budget thins); 429 cooldown honoring `Retry-After` (bounded 30s–30min); serve-stale during cooldown; source-staleness cutoff (120s) before viewport-scoped fallback.
- **Radio catalog health policy:** min 5/9 genre queries succeed, min 375 stations, degraded-mode with generation counters + instance UUIDs.
- **Documentation ethos:** threat-model-honest SECURITY.md, per-source DATA_SOURCES provenance, honest labeling (RECONSTRUCTED ESTIMATE, simulated traffic).
- **Test investment:** co-located unit tests per module (~2,600 passing upstream), rebuilt on Vitest/msw/fast-check/Playwright (see §13 — upstream's harness rotted; ours won't).

### 1.4 Strategic relationship with Tadpole OS
**GEV v2 first, seam pre-cut.** Tadpole is a moving target (private upstream, rolling releases, doc version drift) built for a different tenant (SMB digital twins — parts are deliberate overkill for us). We define five ports in Phase 0 with local stub implementations; Tadpole later replaces stubs via adapters (§6). The showcase story: *"watch a governed agent team build and operate a live OSINT console."* Never couple GEV's critical path to Tadpole stability.

---

## §2 — NON-NEGOTIABLE PRINCIPLES

1. **Boundaries are law.** No file >500 lines without an ADR justifying it. UI components never own Cesium objects. Backend never lives in build config.
2. **Verification before claim.** Tests + headless browser + deterministic scenes. AI-generated plausible wrongness is assumed; the loop catches it.
3. **Keyless boot is the default path.** Globe works with zero keys (MapLibre/PMTiles fallback). Google photoreal is an enhancement, not a gate. AI agent is provider-agnostic (OpenRouter/Ollama/OpenAI behind one interface).
4. **Every outbound fetch goes through `security/pinned-fetch`** with mandatory `AbortSignal.timeout`. Unbounded requests are unrepresentable.
5. **Per-frame writes bypass reactivity.** Entity positions drain a queue inside rAF straight to Cesium. Runes update at human rates only.
6. **Determinism everywhere.** Injectable sim-clock; freeze time in tests; scenes reproducible bit-for-bit.
7. **Literal naming.** No mythological branding near code. An AI (or human) greps `ops-mcp`, `pinned-fetch`, `AuditSink` — never decodes codenames.
8. **Human owns ethics and prod.** All ethical line-calls and prod mutations require human approval (§12).

---

## §3 — ARCHITECTURE

### 3.1 Monorepo layout

```
gev-v2/
├─ PLAN.md                  ← this file
├─ AGENTS.md                ← AI operating manual (§7.5)
├─ RUNBOOK.md               ← operational procedures
├─ docs/
│  ├─ adr/                  ← architecture decision records (INDEX.md required)
│  └─ data-sources/         ← provenance per dataset (port DATA_SOURCES.md ethos)
├─ apps/
│  ├─ web/                  ← Svelte 5 SPA. Vite builds ONLY — serves nothing.
│  └─ server/               ← Hono: proxies, tokens, rate limits, ops API, ws mounts
├─ packages/
│  ├─ contracts/            ← Zod schemas: REST payloads, ws messages, AI tools, ports
│  ├─ core/                 ← pure math/domain (ported upstream modules + property tests)
│  ├─ security/             ← pinned-fetch, SSRF guard, Overpass sanitizer, secret handling
│  ├─ providers/            ← one adapter per source: opensky/ aisstream/ firms/ overpass/ adsblol/ gbfs/ radio/ quakes/ cables…
│  ├─ cesium-kit/           ← ALL imperative Cesium code: entity pools, layer controllers, camera rigs, scene serializer
│  ├─ ops-mcp/              ← MCP server exposing operator tools (§7.2)
│  ├─ governance/           ← the five ports + stubs: AuditSink, ApprovalGate, BudgetGovernor, CapabilityIssuer, AgentEnvelope
│  └─ cli/                  ← `gev` command surface (bin: gev)
├─ e2e/                     ← Playwright specs (run in CI against preview builds)
└─ fixtures/                ← recorded provider responses for seed/mock modes
```

### 3.2 Data-flow laws

```
providers ──► stores (runes) ──► Svelte UI (reads)
                    │
                    └───────────► cesium-kit (imperative subscriber → rAF queue → Cesium)
                                        ▲
voice agent / AI co-user ── tool registry ┘ (same tools serve voice, co-user, ops-mcp)
```

- One-way flow. Stores are the single source of truth. No component-level Cesium ownership.
- Scene serialization (`serializeScene()`/`deserializeScene()` in cesium-kit): camera pose, layer states, selections, drawings/AOIs, sim-time offset → compact Zod-validated JSON in `contracts/`. Dual-use: deep links, deterministic tests, bug-report bundles, multiplayer sync units. **Build in Phase 0.**
- Server topology: browsers meet at the server, never each other. Window 1 = GEV UI, Window 2 = Tadpole console — both talk to the same localhost Hono server (ops API + SSE audit stream + ws).

### 3.3 Stack (decided)

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript 5, strict | Non-negotiable |
| Build | Vite 7 + pnpm workspaces + Turborepo | Verify latest minors at scaffold time; Renovate keeps them current |
| Lint/format | Biome | Replaces ESLint+Prettier; a11y rules on |
| Frontend | Svelte 5 (runes) | No state library — runes ARE the store |
| Components | shadcn-svelte / bits-ui + Tailwind 4 | Accessible primitives free |
| Extras (UI) | paneforge, @tanstack/svelte-virtual, uPlot, svelte-sonner, @lucide/svelte, mode-watcher, vite-plugin-pwa | |
| Globe | @cesium/engine + vite-plugin-cesium-engine | Widget-free core; NOT full `cesium` |
| 2D/offline | maplibre-gl + pmtiles (+ Protomaps basemaps) | Keyless boot + airgapped mode |
| Geo | satellite.js, egm96-universal, mgrs, @turf/turf (modular imports) | |
| Contracts | Zod 4 (zod/mini on client-critical paths) | One source of truth: REST + ws + AI tool defs |
| Server | Hono + @hono/zod-validator + hono-openapi on @hono/node-server | |
| HTTP client (server) | undici Agent w/ custom lookup (TLS pinning) | |
| Jobs/cache | ioredis + BullMQ | Persistent rate limits; FIRMS CSV pulls; catalog rebuilds |
| Logs/traces | pino + pino-http; OpenTelemetry | Redaction built in |
| Voice | official `openai` SDK (Realtime GA: `POST /v1/realtime/client_secrets` → ephemeral `ek_` tokens), XState v5, @ricky0123/vad-web (Silero, in-browser) | Provider adapter pattern for OpenRouter/Ollama |
| Media | hls.js + mpegts.js; reconnecting-websocket wrapper | More cams play; feeds self-heal |
| Test | Vitest + msw + fast-check + Playwright (expect.poll / locator.waitFor — NEVER fixed sleeps) | k6 optional |
| Ops | Docker multi-stage (node:24-alpine), Caddy (auto-HTTPS, brotli, HTTP/3), GitHub Actions, Renovate, self-hosted GlitchTip + PostHog + Plausible | Privacy-consistent telemetry |

### 3.4 Deliberately NOT used
React/Next (VDOM-vs-canvas jank), three.js/custom globe (malpractice to rebuild 3D Tiles ingestion), tRPC/GraphQL (REST+Zod+generated OpenAPI stays curl-debuggable), Electron/Tauri (PWA covers it), axios (bare fetch/undici with timeout semantics), Tadpole's Rust engine (our orchestration surface stays TS), payments ledger/economic zones, force-graph HUD dashboards, any browser↔browser direct protocol.

---

## §4 — FIRST-WEEK DELIVERABLES (Phase 0 artifacts, §10 has full schedule)

Critical-path order:

1. Workspace scaffold, CI green on empty repo (lint, typecheck, test, build, Playwright smoke on placeholder page).
2. `contracts` package: flight-feed schema + the five port schemas (§6).
3. `security` package: pinned-fetch ported from upstream + its test suite.
4. `core` package: ported math modules + fast-check property tests.
5. Globe renders ONE live feed (flights) end-to-end through the real server — keyless (MapLibre default tile layer; Cesium ion-free imagery).
6. Sim-clock injection + seed-mode providers (recorded fixtures; zero live-API calls in dev/tests).
7. `governance` stubs wired: every mutating op logs intent/outcome to SQLite; budget cap trips STASIS flag.
8. `ops-mcp` + `gev` CLI skeletons; `window.__gev` debug bus (dev builds only, Zod-described, versioned).
9. AGENTS.md, RUNBOOK.md, docs/adr/INDEX.md, ADG documentation-drift CI gate.
10. Scene serializer + `/scene` deep links.

---

## §5 — SECURITY ARCHITECTURE

- **Threat model doc first** (SECURITY.md rewritten for new topology before Phase 1 merges). Localhost binding default; explicit LAN-exposure warnings; SSRF mitigations as §1.3; no credentials in URLs; redirect rejection; response byte caps.
- **Secrets:** server-held only. Client gets ephemeral tokens (`ek_`) minted per-session. BYO user keys stored via vault pattern (AES-256-GCM, Web Worker, volatile memory — Tadpole Neural Vault pattern). Logs redacted by construction (pino redact paths); AI agents never see raw credentials — interfaces only.
- **Rate limiting:** Redis-backed (survives restarts — fixes upstream's in-memory gap). Defaults: generous on free proxies, **auth-required-by-default on money-spending endpoints** (upstream had opt-in limiting/unlimited-by-default — we invert that for OpenAI routes specifically).
- **CCTV/media proxy:** connect timeout + idle timeout + total stream lifetime (closes upstream #25/#26 class; #53 fix absorbed by rule 4 of §2).
- **Licensing hygiene:** NO non-commercial data bundled. TeleGeography cable data → optional download pack with license gate at runtime. ODbL sources isolated in their own packages with share-alike noted. 3D models individually licensed; replace MQ-9 glb or document license explicitly. `package.json` license field reflects reality (upstream claimed flat MIT while bundling CC BY-NC-SA — don't repeat).

---

## §6 — THE TADPOLE SEAM (ports, not promises)

Five interfaces in `packages/contracts/src/ports.ts`, stubbed in `packages/governance/`, event vocabulary aligned to Tadpole semantics from day one.

```ts
// Sketch — full Zod schemas in contracts
export const AuditIntent = z.object({
  id: z.uuid(), ts: z.datetime(), actor: z.enum(['ai','human','system']),
  action: z.string(), target: z.string(), params: z.unknown().optional(),
  taskRef: z.string() });
export const AuditOutcome = AuditIntent.extend({
  intentId: z.uuid(),
  status: z.enum(['ok','error','blocked']),
  result: z.unknown().optional(), error: z.string().optional() });

export interface AuditSink        { intent(i: AuditIntent): void; outcome(o: AuditOutcome): void; tail(q?: Query): AuditRecord[] }
export interface ApprovalGate     { request(r: ApprovalRequest): Promise<ApprovalResult> }
export interface BudgetGovernor   { check(a: Action, est: CostEstimate): Verdict; trip(reason: TripCode): void; state(): BudgetState }
export interface CapabilityIssuer { issue(scopes: string[], ttl: Duration): CapToken; verify(t: CapToken): Scopes | null }
export interface AgentEnvelope    { wrap(task: TaskBrief): EnvelopedTask }   // 4-Pillar, §7.6
```

| Port | Phase 0 stub | Tadpole merge replaces with |
|---|---|---|
| AuditSink | SQLite intent/outcome log | Merkle-chained WAL (SHA-256 links, tamper-evident) |
| ApprovalGate | Browser prompt for mutating ops | Ed25519-signed approvals |
| BudgetGovernor | Hardcoded caps + STASIS flag | Full ledger governance |
| CapabilityIssuer | Static scoped tokens | Signed capability tokens |
| AgentEnvelope | 4-pillar schema | Tadpole native format |

Typed error registry from day one: `BUDGET_BREACH`, `LOGIC_BLOCKER`, `COMPLIANCE_DRIFT` — each with documented remediation path in RUNBOOK.md.

**Merge ladder (each rung independently shippable, demo-truthful at every rung):**
- **M1 Observer** — Tadpole reads GEV audit stream + feed health (days after Phase 1).
- **M2 Gatekeeper** — signed approvals become the real ApprovalGate.
- **M3 Governor** — STASIS enforcement moves to Tadpole budgets.
- **M4 Runtime** — agent team operates GEV end-to-end under Tadpole governance (the flagship demo).

Tool-manifest flags on every ops-mcp/AI-tool definition: `is_mutating`, `is_dangerous`, `is_cacheable` — prod gating becomes data-driven.

---

## §7 — AI OPERABILITY

### 7.1 Observe plane (build in Phases 0–1)
pino JSON logs with correlation IDs (redacted) · feed-health endpoint (per-provider last-success/error-rate/quota-remaining/TTL-tier) · OTel spans client→server→provider · client errors with serialized-scene attachments (GlitchTip) · perf budgets enforced in CI (bundle size, Lighthouse, Cesium frame-time harness) · semantic event log (camera ops, toggles, selections, feed errors — NO video; rrweb cannot capture WebGL, semantic replay is the only way).

### 7.2 Act plane
`ops-mcp` tools (all Zod-described, flagged): `get_feed_health`, `get_budget`, `run_diagnostics`, `load_scene`, `save_scene`, `set_flag`, `profile_route`, `replay_events`, `tail_logs`, `screenshot`.
`gev` CLI: `dev`, `test`, `qa`, `scene load|save`, `feeds health`, `status`, `resume`, `audit tail`, `flags ls|set`.
Debug bus: `window.__gev` (dev-gated) for headless inspection/screenshot/diagnosis.
Flags-as-circuit-breakers per data source (self-hosted PostHog/Unleash): provider dies upstream → flag flip in minutes, not emergency patch. (Lesson: upstream's Google tiles 401 outage, issue #59.)

### 7.3 Governance behaviors (from Tadpole, implemented natively now)
- **WAL:** `[INTENT]` logged BEFORE execution, `[OUTCOME]` after; chained hashes.
- **STASIS:** budget breach ⇒ suspend all agents, snapshot state to audit trail, alert human. `STASIS_ACTIVE` visible in `gev status`. Only human runs `gev resume`. Never self-resume.
- **ADG (Active Documentation Guard):** ts-morph/tree-sitter extracts symbol table; CI fails if backticked symbols in doc headers don't exist in code, referenced paths don't exist, or version/date strings drift across docs. Applies to PLAN.md, AGENTS.md, READMEs, ADRs.
- **Session hygiene:** parallel agent sessions receive sanitized findings only (`visible_transcript` pattern); read-cache keyed by args+workspace-root invalidated on any write; 30s-TTL file leases prevent concurrent-edit collisions.

### 7.4 Working loop
Dev sets direction → AI implements with tests → AI verifies in headless browser (Playwright screenshots against real rendering) → dev reviews diff → CI gates → merge. Every AI change is a PR. Division of labor: AI does boilerplate/test-generation/edge-case enumeration/cross-codebase grep/type-discipline; human does product taste, architecture gut-checks, and ALL ethical calls.

### 7.5 AGENTS.md contents (write in Phase 0)
Project identity & glossary · repo map with one-line purpose per package · canonical commands · Definition of Done · the working loop above · guardrails summary (§12) · STASIS procedure · escalation rules · the 4-Pillar template · pointer to PLAN.md as source of truth.

### 7.6 Task briefing — 4-Pillar Envelope (mandatory format for dev→AI tasks)
```
[SCOPE_CONTRACT]         files/packages in scope, explicitly out of scope
[PERFORMANCE_THRESHOLD]  measurable done-criteria (tests green, latency, bundle delta)
[ARCHITECTURE_MODE]      which laws of §2/§3 apply; allowed deviations (none by default)
[FAILURE_MODES]          known traps for this task; what to do when blocked (LOGIC_BLOCKER)
```

---

## §8 — FEATURE ROADMAP (layer order)

Parity target = upstream's 13 layers. Order chosen by value/risk:

1. **Flights** (OpenSky + adsb.lol fallback; cost governor ported) — Phase 0/1 proof feed
2. **Ships** (AISStream ws; aisWatchdog pattern) 
3. **Satellites** (SGP4 + egm96; sim-clock demos)
4. **Quakes + fires** (USGS/EMSC; FIRMS CSV via BullMQ job)
5. **Search/geocode** (Nominatim keyless; MGRS readouts)
6. **Public CCTV** (server-registered URLs only; HLS/MPEGTS; full timeout lifecycle)
7. **Radio** (allowlisted proxy; catalog health policy ported)
8. **Launch replays** (modeled-data labeling preserved)
9. **Weather/GFSA-style extras + GBFS transit** (fix upstream #61 v3-shapes bug natively)
10. **Voice agent** (Phase 3 — provider-agnostic, XState lifecycle, VAD-local, tools = shared registry)

Each layer ships with: provider adapter + fixture tests + Playwright smoke passing on merge + feed-health integration + flag kill-switch.

---

## §9 — COLLABORATION TIERS (post-parity)

- **T0 Serializer** — Phase 0 (see §3.2). Prerequisite for everything below.
- **T1 Dev↔User loop** (~1 wk): "Copy debug bundle" button (redacted scene JSON + feed health + last-N provider errors + build hash → pasted into issues; `gev scene load` reproduces exactly) · semantic session replay (PostHog self-hosted) · flags with per-source kill-switches.
- **T2 User↔User live co-op** (~2–3 wks): Yjs CRDT per room over `y-websocket` mounted on Hono. **Sync intent, never telemetry** — doc holds selections/annotations/AOIs/layer-toggles/follow-targets as references (`{kind:'aircraft', id:'…'}`); the 10k-entity stream stays in the rAF pipeline. Awareness: named cursors, viewport outlines, follow-me leader mode. Identity: signed room tokens (jose JWT; roles viewer/operator), optional passkeys (@simplewebauthn). Rooms ephemeral, TTL'd, nothing persisted. Paranoid mode: y-webrtc P2P (server signals only). Voice agent joins rooms as a visible participant — its tool calls auditable by everyone present.
- **T3 TAK/CoT bridge** (upstream issue #7 demand): CoT as another provider adapter; BYO TAK server; client certs server-side; honor CoT stale times; explicit per-object "send to TAK."
- **Co-user AI:** same room protocol; my presence = named cursor ("copilot"); my actuators = the shared tool registry (one surface serving voice agent, me-as-co-user, and ops-mcp). In-app assistant answers grounded questions ("why no flights over the Atlantic?") by querying feed health — not guessing.

**Multiplayer ethics:** callsign handles only; no real names in awareness metadata; coarse presence only unless opted in; ephemeral rooms; shared annotation of public infrastructure OK; coordinating pursuit of an individual NOT OK (hard line, §12).

---

## §10 — PHASED EXECUTION (checkboxes = living progress tracker)

### Phase 0 — Walking skeleton + AI-operability keel (Week 1 + 4–5 days)
- [x] Monorepo scaffold, CI green on empty (lint/type/test/build/smoke)
- [x] contracts pkg: flight schema + five port schemas
- [x] security pkg: pinned-fetch ported + tests
- [x] core pkg: math modules ported + property tests
- [x] Globe renders flights end-to-end, keyless
- [x] Sim-clock + seed-mode providers (no live calls in dev/test)
- [x] governance stubs live (WAL to SQLite, STASIS trip, prompt approvals)
- [x] ops-mcp + gev CLI skeletons; debug bus
- [ ] AGENTS.md, RUNBOOK.md, adr/INDEX.md, ADG gate
- [ ] Scene serializer + deep links
- [ ] SECURITY.md threat model drafted for new topology

### Phase 1 — Server parity (Weeks 2–3)
- [ ] Every upstream proxy ported out of vite.config.js into Hono routes
- [ ] Cost governor (TTL tiers, Retry-After cooldown, staleness cutoff) as middleware + tests
- [ ] Radio proxy w/ TLS pinning + catalog health policy
- [ ] Overpass sanitizer ported + property tests
- [ ] CCTV media proxy with full timeout lifecycle
- [ ] Redis rate limits; auth-default on OpenAI token route
- [ ] Feed-health endpoint + OTel wiring complete
- [ ] **M1 merge-rung ready** (audit stream readable externally)

### Phase 2 — Layers (Weeks 3–6)
- [ ] Layers 2–5 of §8, each with adapter+fixtures+smoke+flags
- [ ] Layers 6–9 of §8
- [ ] Perf budgets enforced in CI; frame-time harness green
- [ ] PWA shell; virtualized lists; uPlot timelines

### Phase 3 — Voice agent + co-user foundations (Weeks 6–8)
- [ ] Provider-agnostic agent endpoint (OpenAI Realtime GA flow; OpenRouter/Ollama adapters)
- [ ] XState session machine; barge-in/recovery tested
- [ ] Tool registry generated from contracts (shared triple-consumer surface)
- [ ] VAD-local audio gating
- [ ] Yjs rooms + awareness + room tokens (T2)

### Phase 4 — Hygiene & showcase (Week 9)
- [ ] Docs regenerated; DATA_SOURCES provenance per layer
- [ ] Licensing cleaned (NC data → download packs; model licenses explicit)
- [ ] Self-hosted telemetry finalized; k6 load pass on proxies
- [ ] Demo script: governed agent team operating live console (M1/M2 truthfully demonstrated)
- [ ] Tadpole integration spike toward M2

**Effort:** solo ≈ 10–12 wks to parity (+2 wks collab tiers); two devs ≈ 6–8 wks. Porting upstream assets saves ~30%.

**Global Definition of Done (every PR):** tests green · Playwright smoke passes on merge (waits on conditions, never sleeps) · strict types · ADG passes (docs match symbols) · no new dep without one-line justification in PR · audit entries for any mutating action · flag added for anything touching external services.

---

## §11 — UPSTREAM LESSONS: DO NOT REPLICATE

| Upstream failure | Issue(s) | Our structural fix |
|---|---|---|
| CCTV proxy hung forever (no connect timeout) | #25/#26/#53 | §2 rule 4: mandatory timeouts in pinned-fetch |
| App unbootable without Google key (10/13 layers were free) | #60 | Keyless boot default; MapLibre/PMTiles |
| Headline feature broke via upstream 401 (Google tiles) | #59 | Flags as kill-switches; Renovate; provider isolation |
| QA gates fail deterministically on clean main (fixed 300ms sleeps racing debounce) | #44/#54 | Playwright condition-waits only; CI runs on main from day one |
| GBFS v3 `[object Object]` names | #61 | Contract validation at provider boundary (Zod) |
| Flat-MIT claim while bundling CC BY-NC-SA cable data | LICENSE | §5 licensing hygiene |
| Stale repo metadata after fork | — | Metadata in scaffold checklist |
| Zero merges during 64-issue flood; no CI | tracker | CI day one; PR cadence in working loop |

---

## §12 — ETHICS & GUARDRAILS

**Hard lines (from upstream's stated ethic, kept and sharpened):** no person-tracking, no face-recognition, no de-anonymization features. Adjacent-case procedure: anything like ALPR/plate-reader mapping (upstream #63) or IMSI-catcher layers (#56) requires a human decision recorded as an ADR **before** any code is written. AI never decides these.

**Operational guardrails:** spend caps neither dev-nor-AI can raise from inside a session (env-set only) · secrets invisible to AI, redacted in logs · audit trail on every action with taskRef · prod writes require human approval (full autonomy in dev/staging only) · least privilege default (read-only telemetry unless granted more).

**Privacy posture (product-level):** local-first keys, self-hosted telemetry/analytics, airgap-capable (PMTiles), ephemeral multiplayer rooms, coarse-only presence.

---

## §13 — TESTING & CI POLICY

Unit: Vitest, co-located, property tests (fast-check) on all math/sanitizer/security modules · Network: msw fixtures only in CI — suites cannot rot when providers change · E2E: Playwright, condition-based waits exclusively (`expect.poll`, `locator.waitFor`), run against preview builds · Perf: bundle-size budget, Lighthouse CI, Cesium frame-time harness · Drift: ADG gate · Deps: Renovate grouped weekly, auto-merged patch when green · Load: k6 on proxies pre-release.

---

## §14 — DECISION LOG (ADR seeds — write these as docs/adr/000x-*.md in Phase 0)

001 Monorepo + pnpm/Turborepo over single-app · 002 Svelte 5 over React (canvas adjacency, runes-as-stores) · 003 @cesium/engine widget-free · 004 Hono over Fastify/vite-middleware-backend · 005 REST+Zod over tRPC · 006 No state library · 007 Five-port governance seam & merge ladder · 008 Semantic-event replay over video replay (WebGL constraint) · 009 Sync-intent-not-telemetry (CRDT scope) · 010 Keyless-boot default renderer strategy · 011 Auth-default on billable endpoints (inverted from upstream opt-in) · 012 Literal naming policy · 013 NC-data exclusion from bundles.

---

## §15 — RISKS

| Risk | Mitigation |
|---|---|
| Hono WS adapter immaturity (voice bridge) | Route layer thin; swap-to-Fastify contingency ≈ 1 week |
| Svelte hiring pool smaller than React | 80% of hard code (core/security/providers) framework-free TS |
| Tadpole instability delays M-rungs | Ports decouple; stubs fully functional standalone |
| Live-provider breakage mid-build | Seed mode + fixtures + flags; CI never touches live APIs |
| Quota burn during development | Governor ported early; dev defaults to fixtures; caps env-set |
| Scope creep toward surveillance-adjacent features | §12 ADR-before-code procedure; human sign-off mandatory |
| Doc drift confusing future AI sessions | ADG gate + this plan as single source of truth + resume protocol §0 |

---

*End of plan. When resuming: execute §0 steps 1–7, then continue from the first unchecked box in §10.*
