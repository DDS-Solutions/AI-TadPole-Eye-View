# AI-Tadpole-Eye-View

> Watch the world live - then watch governed AI agents build and run the thing doing the watching.

[![Status](https://img.shields.io/badge/status-phase%204%20complete%20(M1--M3)-brightgreen)]() [![License](https://img.shields.io/badge/code-MIT-blue)](#license) [![Governed by](https://img.shields.io/badge/governed%20by-AI--TadPole--OS-purple)](https://github.com/DDS-Solutions/AI-TadPole-OS)

A live 3D OSINT console tracking **flights, ships, earthquakes, wildfires, bike transit, weather radar, public CCTV, radio, and submarine cables** on a photorealistic globe -- rebuilt ground-up from [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) as an **agent-native codebase**: designed from commit one so AI agents can develop, deploy, monitor, and debug it *alongside humans*, under enforceable governance (audit trails, approval gates, spend caps).

**Full build plan:** [PLAN.md](./PLAN.md) | **AI operating manual:** [AGENTS.md](./AGENTS.md) | **Data provenance:** [DATA_SOURCES.md](./DATA_SOURCES.md) | **Licenses:** [docs/LICENSES.md](./docs/LICENSES.md)

---

## Why this repo exists

Two experiments in one project:

1. **A serious OSINT console.** Multi-layer live feeds, honest data labeling, keyless boot by default, privacy-first architecture.
2. **A governed AI dev team.** Every feature was built, tested, and operated by autonomous AI agents working under [AI-TadPole-OS](https://github.com/DDS-Solutions/AI-TadPole-OS) oversight -- with a tamper-evident audit trail proving it.

Most agent demos show swarm diagrams. This one shows a working product and the receipts for how it got there.

## Features

> **Status key:** `ACTIVE` = Implemented end-to-end | `PARTIAL` = Partially implemented (see Notes) | `NOT BUILT` = No implementation exists

| Layer | Source | Status | Notes |
|---|---|---|---|
| Flights | OpenSky Network, adsb.lol | ACTIVE | Provider, server route, Cesium layer, 1.25 MB fixture. Phase 0/1 proof feed. |
| Ships | AISStream | ACTIVE | `ais.ts` provider, server route, marine Cesium layer, fixture. |
| Earthquakes | USGS Earthquake API | ACTIVE | `usgs.ts` provider, server route, quake Cesium layer, fixture. |
| Wildfires | NASA FIRMS | ACTIVE | `firms.ts` provider, server route, FIRMS Cesium layer, fixture. |
| Bike Transit | GBFS Standard Feeds | ACTIVE | `gbfs.ts` provider, server route, GBFS Cesium layer, fixture. |
| Public CCTV | DOT Traffic Camera Feeds | ACTIVE | `cctv.ts` provider, media-proxy server route, CCTV Cesium layer, fixture. |
| Live Radio | Radio Browser Community Directory | ACTIVE | `radio.ts` provider, server proxy route, radio Cesium layer, fixture. |
| Orbital Launches | Launch Dashboard Feeds | ACTIVE | `launches.ts` provider, server route, launch Cesium layer, fixture. |
| Weather Radar | RainViewer, NOAA | ACTIVE | `weather.ts` provider, server route, weather Cesium layer, fixture. |
| Submarine Cables | TeleGeography NC Download Pack | PARTIAL | `cables.ts` provider and contract schemas exist. Server route and Cesium layer NOT wired into the app. Data ships as optional download pack (NC license gate at runtime, never bundled). |
| Satellites | CelesTrak / Space-Track SGP4 | NOT BUILT | No implementation exists: no satellite provider file, no SGP4 math in `core/`, no Cesium layer. Planned in PLAN.md section 8. |
| AI Voice Copilot | OpenAI Realtime, Seed/Mock Driver | ACTIVE | `voiceMachine.ts` (XState v5), `VoiceControlOrb.svelte`, `voice.svelte.ts`, `MockAgentAdapter` + `OpenAIRealtimeAdapter` in `core/`, voice token route on server. Mock driver works without API keys. |
| T2 Live Co-Op | Custom CRDT Rooms + Presence | PARTIAL | Yjs dep installed. `CollabRoomManager` (native CRDT via `CollabIntentDoc`), JWT-signed room tokens, `CollabBar.svelte` UI, `collab.ts` store. No `y-websocket` server -- CRDT sync is a custom WS protocol, not standard Yjs networking. |

**Keyless boot:** the globe works with zero API keys out of the box using local recorded fixtures and OpenStreetMap raster tiles. Google Photorealistic 3D Tiles and live provider streams are optional enhancements, never a gate.

## Architecture

```
[Browser: GEV v2 UI] --+
                       +--> [Hono server] --> providers (OpenSky, AIS, FIRMS...)
[Tadpole console] -----+         |
                                 +- ops API + SSE audit stream (/ops/audit)
                                 +- Collab intent rooms (/api/collab)
                                 +- ephemeral voice session tokens (/api/voice)
                                 +- self-hosted telemetry and metrics (/api/telemetry/metrics)
                                 +- governance ports: AuditSink, ApprovalGate,
                                    BudgetGovernor, CapabilityIssuer, AgentEnvelope
```

- **Monorepo:** `apps/web` (Svelte 5 SPA) | `apps/server` (Hono API and WebSocket Server) | `packages/{contracts, core, security, providers, cesium-kit, ops-mcp, governance, cli}`
- **Contracts-first:** Zod schemas define REST payloads, WebSocket messages, collaborative intent documents, and AI tool definitions from a single source of truth.
- **Security by construction:** Every outbound fetch goes through an SSRF-guarded, TLS-pinned fetcher with mandatory timeouts. Unbounded requests are unrepresentable.

## Governance (the Tadpole seam)

AI actions in this repo run under five enforced ports -- local stubs backed by SQLite WAL and Ed25519 cryptographic signatures:

| Rung | Capability | Status | Honest Notes |
|---|---|---|---|
| M1 Observer | Tadpole reads the live audit stream (`/ops/audit`) + feed health | IMPLEMENTED | `auditStream.ts` server route, SSE streaming, `SqliteAuditSink` WAL. |
| M2 Gatekeeper | Mutating ops require Ed25519-signed approvals (`ApprovalGate`) | IMPLEMENTED | `TadpoleM2Gatekeeper` + `MerkleAuditChain` in `governance/`, wired in demo + ops-mcp. |
| M3 Governor | Budget enforcement + STASIS lockdown (`BudgetGovernor`) | IMPLEMENTED | `CapBudgetGovernor` STASIS trip + human-only resume; verified in `gev demo`. |
| M4 Runtime | Real AI agent team operates the live console end-to-end under governance | NOT YET REACHED | `gev demo` simulates M1-M3 in-process (CLI only). M4 = an actual agent process driving a running server via ops-mcp under live governance -- not yet built. |

> **Truth note on the demo:** `gev demo` is a verified CLI simulation of M1-M3 governance mechanics (audit WAL, STASIS trip, Merkle chain integrity, human resume). It is NOT a live agent team controlling a running browser + globe. That is M4 scope.

Spend caps trip STASIS -- all agents suspend until a human resumes them. No self-resume. Ever.

## Quick start

```bash
git clone https://github.com/DDS-Solutions/AI-Tadpole-Eye-View
cd AI-Tadpole-Eye-View
pnpm install
pnpm gev dev          # http://localhost:5173 -- keyless seed mode by default
```

Run tests, showcase demonstration, and health diagnostics:

```bash
pnpm gev status       # inspect phase, STASIS, budget, and feeds
pnpm gev demo         # run M1-M3 governance showcase (CLI simulation, not live agent)
pnpm gev test         # run complete unit and property test suites
node scripts/adg.mjs  # run Active Documentation Guard
```

## What is built vs what is pending

### Fully built

- Monorepo scaffold, CI, Turborepo (`turbo.json`, `biome.json`, `pnpm-workspace.yaml`)
- `packages/contracts` -- Zod schemas for all feeds, ports, voice, collab, scene, tools (17 files)
- `packages/security` -- pinned-fetch (SSRF guard, TLS pinning, redirect rejection, byte caps)
- `packages/core` -- cockpitMath, geoMath, scopeMask, sim-clock, scene serializer, XState voice machine, agent adapters, tool executor, collab intent doc (10 files)
- `packages/governance` -- `SqliteAuditSink` (WAL + subscriber), `CapBudgetGovernor` (STASIS), `PromptApprovalGate`, `TadpoleM2Gatekeeper` (Ed25519), `MerkleAuditChain`
- `packages/providers` -- OpenSky, AIS, USGS, FIRMS, GBFS, Radio, CCTV, Launch, Weather, Cables (11 files; cables provider not wired to UI)
- `packages/cesium-kit` -- Globe, BaseLayer, FlightLayer, MarineLayer, QuakeLayer, FirmsLayer, GbfsLayer, CctvLayer, RadioLayer, LaunchLayer, WeatherLayer, CollabLayer, DebugBus, FrameBudget (15 files)
- `packages/ops-mcp` -- MCP server with full Zod-described tool set
- `packages/cli` -- `gev` command surface: `status`, `demo`, `audit`, `feeds`, `scene`, `resume`
- `apps/server` -- Hono server with all 14 provider proxy routes, CCTV media proxy, voice token route, collab WS, audit SSE, feed health endpoint, telemetry, cost governor middleware
- `apps/web` -- Svelte 5 SPA: `App.svelte`, 7 HUD components, 3 Svelte rune stores (layers, voice, collab)
- `e2e/smoke.spec.ts` -- Playwright smoke test (condition-waits only, no fixed sleeps)
- `fixtures/` -- Recorded fixtures for 9 implemented providers (including 1.25 MB OpenSky replay)
- ADRs 0014-0029 (16 decision records), DESIGN.md, SECURITY.md, RUNBOOK.md, DATA_SOURCES.md, AGENTS.md

### Partially built

- **Submarine cables UI** -- `packages/providers/src/cables.ts` + contract schemas complete. Server route and `cesium-kit` layer not created; cables are not visible in the app.
- **T2 Collab** -- Custom CRDT room manager with JWT tokens + WebSocket broadcast works. Yjs is a listed dependency but `y-websocket` server is not used; the CRDT sync is a custom protocol over raw WS.

### Not yet built

- **Satellites layer** -- No provider file, no SGP4 / egm96 math in `core/`, no Cesium layer. Listed as item 3 in PLAN.md section 8 (high-value next target).
- **M4 Runtime** -- A live AI agent process actually operating the running console via ops-mcp under governance. Current demo is a CLI simulation only.
- **T3 TAK/CoT bridge** -- Post-parity roadmap item per PLAN.md section 9.
- **k6 load tests** -- `load/` directory exists but contains no scripts. `check-bundle-budgets.mjs` exists but k6 runner not configured.
- **Full self-hosted telemetry stack** -- GlitchTip / PostHog / Plausible referenced in PLAN.md. `ServerTelemetryManager` class exists in `apps/server` but the external self-hosted services are not configured.

## Documentation

- [PLAN.md](./PLAN.md) -- master build plan, phased roadmap, progress tracker (single source of truth)
- [AGENTS.md](./AGENTS.md) -- how AI agents operate in this repo
- [SECURITY.md](./SECURITY.md) -- threat model
- [DATA_SOURCES.md](./DATA_SOURCES.md) -- dataset provenance, rate limits, and honest labeling
- [docs/LICENSES.md](./docs/LICENSES.md) -- software, asset, and NC download pack licenses
- [RUNBOOK.md](./RUNBOOK.md) -- operational procedures including STASIS recovery
- [docs/adr/INDEX.md](./docs/adr/INDEX.md) -- Architecture Decision Records (ADRs 0014-0029)

## Ethics

Hard lines, inherited and sharpened from upstream: **no person-tracking, no face-recognition, no de-anonymization features.** Adjacent proposals (e.g., camera-location mapping) require a recorded human decision before any code is written. See section 12 of [PLAN.md](./PLAN.md).

## License

Code: **MIT**. Bundled datasets and 3D models carry their own licenses -- non-commercial data ships as optional download packs, never bundled. Details in [docs/LICENSES.md](./docs/LICENSES.md) and [LICENSE](./LICENSE).

## Credits

Built on ideas and ported modules from [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (~2k stars). Governance runtime: [AI-TadPole-OS](https://github.com/DDS-Solutions/AI-TadPole-OS).