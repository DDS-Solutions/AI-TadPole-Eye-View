# AI-Tadpole-Eye-View

> Watch the world live — then watch governed AI agents build and run the thing doing the watching.

[![Status](https://img.shields.io/badge/status-Early%20Stage%20WIP-orange)](./PLAN.md) [![Phase](https://img.shields.io/badge/phase-5.0%20(Hardening)-blue)](./PLAN.md) [![Governance](https://img.shields.io/badge/governed%20by-AI--TadPole--OS-purple)](https://github.com/DDS-Solutions/AI-TadPole-OS) [![License](https://img.shields.io/badge/code-MIT-blue)](#license)

> ⚠️ **Project Status: Early Stage WIP (Work in Progress)**  
> This repository is an active, ground-up rewrite of [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) into an agent-native architecture under [AI-TadPole-OS](https://github.com/DDS-Solutions/AI-TadPole-OS) governance. Core telemetry layers, security perimeters, typed provider registries, and M1–M3 cryptographic governance mechanics are implemented and verified in seed/simulation mode. Full live multi-agent orchestration (M4) and remaining telemetry layers are in active development.

A live 3D OSINT console tracking **flights, ships, earthquakes, wildfires, bike transit, weather radar, public CCTV, radio, and submarine cables** on a photorealistic globe — designed from commit one so AI agents can develop, deploy, monitor, and debug it *alongside humans*, under enforceable governance (audit trails, approval gates, spend caps).

**Full build plan:** [PLAN.md](./PLAN.md) | **AI operating manual:** [AGENTS.md](./AGENTS.md) | **Data provenance:** [DATA_SOURCES.md](./DATA_SOURCES.md) | **Licenses:** [docs/LICENSES.md](./docs/LICENSES.md)

---

## Why this repo exists

Two experiments in one project:

1. **A serious OSINT console.** Multi-layer live feeds, honest data labeling, keyless boot by default, privacy-first architecture.
2. **A governed AI dev team.** Every feature was built, tested, and operated by autonomous AI agents working under [AI-TadPole-OS](https://github.com/DDS-Solutions/AI-TadPole-OS) oversight — with a tamper-evident audit trail proving it.

Most agent demos show swarm diagrams. This one shows a working product and the receipts for how it got there.

## Features & Implementation Status

> **Status key:** `ACTIVE` = Implemented end-to-end | `PARTIAL` = Partially implemented (see Notes) | `NOT BUILT` = No implementation exists

| Layer / Capability | Source / Engine | Status | Notes |
|---|---|---|---|
| ✈️ Flights | OpenSky Network, adsb.lol | ACTIVE | Provider adapter, server proxy route, Cesium layer, 1.25 MB fixture replay. |
| 🚢 Ships | AISStream | ACTIVE | `ais.ts` provider, server route, marine Cesium layer, fixture. |
| 🌍 Earthquakes | USGS Earthquake API | ACTIVE | `usgs.ts` provider, server route, quake Cesium layer, fixture. |
| 🔥 Wildfires | NASA FIRMS | ACTIVE | `firms.ts` provider, server route, FIRMS Cesium layer, fixture. |
| 🚲 Bike Transit | GBFS Standard Feeds | ACTIVE | `gbfs.ts` provider, server route, GBFS Cesium layer, fixture. |
| 📷 Public CCTV | DOT Traffic Camera Feeds | ACTIVE | `cctv.ts` provider, media-proxy server route, CCTV Cesium layer, fixture. |
| 📻 Live Radio | Radio Browser Community Directory | ACTIVE | `radio.ts` provider, server proxy route, radio Cesium layer, fixture. |
| 🚀 Orbital Launches | Launch Dashboard Feeds | ACTIVE | `launches.ts` provider, server route, launch Cesium layer, fixture. |
| 🌦️ Weather Radar | RainViewer, NOAA | ACTIVE | `weather.ts` provider, server route, weather Cesium layer, fixture. |
| 🗺️ Overpass / OSM | OpenStreetMap Overpass API | ACTIVE | Overpass QL sanitizer in `@gev/security`, server proxy route, query endpoint. |
| 🌐 Submarine Cables | TeleGeography NC Download Pack | PARTIAL | `cables.ts` provider and contract schemas exist. Server route and Cesium layer NOT wired into the app. Data ships as optional download pack (NC license gate at runtime, never bundled). |
| 🛰️ Satellites | CelesTrak / Space-Track SGP4 | NOT BUILT | No implementation exists: no satellite provider file, no SGP4 math in `core/`, no Cesium layer. Planned in PLAN.md section 8. |
| 🎙️ AI Voice Copilot | OpenAI Realtime, Seed/Mock Driver | ACTIVE | `voiceMachine.ts` (XState v5), `VoiceControlOrb.svelte`, `voice.svelte.ts`, `MockAgentAdapter` + `OpenAIRealtimeAdapter` in `core/`, voice token route on server. Mock driver works without API keys. |
| 👥 T2 Live Co-Op | Custom CRDT Rooms + Presence | PARTIAL | Yjs dependency installed. `CollabRoomManager` (native CRDT via `CollabIntentDoc`), JWT-signed room tokens, `CollabBar.svelte` UI, `collab.ts` store. Custom WebSocket synchronization protocol (not standard `y-websocket` server). |

**Keyless boot:** The globe works with zero API keys out of the box using local recorded fixtures and OpenStreetMap raster tiles. Google Photorealistic 3D Tiles and live provider streams are optional enhancements, never a gate.

## Architecture

```
[Browser: GEV v2 UI] ──┐
                       ├──► [Hono server] ──► providers (OpenSky, AIS, FIRMS...)
[Tadpole console] ─────┘         │
                                 ├─ ops API + SSE audit stream (/ops/audit)
                                 ├─ Collab intent rooms (/api/collab)
                                 ├─ ephemeral voice session tokens (/api/voice)
                                 ├─ self-hosted telemetry and metrics (/api/telemetry/metrics)
                                 └─ governance ports: AuditSink, ApprovalGate,
                                    BudgetGovernor, CapabilityIssuer, AgentEnvelope
```

- **Monorepo:** `apps/web` (Svelte 5 SPA) | `apps/server` (Hono API and WebSocket Server) | `packages/{contracts, core, security, providers, cesium-kit, ops-mcp, governance, cli}`
- **Contracts-first:** Zod schemas define REST payloads, WebSocket messages, collaborative intent documents, capabilities, and AI tool definitions from a single source of truth (`packages/contracts`).
- **Security by construction:** Every outbound fetch goes through an SSRF-guarded, TLS-pinned fetcher with mandatory timeouts (`packages/security`). Unbounded requests are unrepresentable.

## Governance (the Tadpole seam)

AI actions in this repo run under five enforced ports — local stubs backed by SQLite WAL and Ed25519 cryptographic signatures:

| Rung | Capability | Status | Honest Notes |
|---|---|---|---|
| **M1 Observer** | Tadpole reads the live audit stream (`/ops/audit`) + feed health | IMPLEMENTED | `auditStream.ts` server route, SSE streaming, `SqliteAuditSink` WAL. |
| **M2 Gatekeeper** | Mutating ops require Ed25519-signed approvals (`ApprovalGate`) | IMPLEMENTED | `TadpoleM2Gatekeeper` + `MerkleAuditChain` in `governance/`, wired in demo + ops-mcp. |
| **M3 Governor** | Budget enforcement + STASIS lockdown (`BudgetGovernor`) | IMPLEMENTED | `CapBudgetGovernor` STASIS trip + human-only resume; verified in `gev demo`. |
| **M4 Runtime** | Real AI agent team operates the live console end-to-end under governance | NOT YET REACHED (WIP) | `gev demo` simulates M1–M3 in-process (CLI only). M4 = an actual agent process driving a running server via ops-mcp under live governance — in progress. |

> **Truth note on the demo:** `gev demo` is a verified CLI simulation of M1–M3 governance mechanics (audit WAL, STASIS trip, Merkle chain integrity, human resume). It is NOT a live agent team controlling a running browser + globe. That is M4 scope.

Spend caps trip **STASIS** — all agents suspend until a human resumes them. No self-resume. Ever.

## Quick start

```bash
git clone https://github.com/DDS-Solutions/AI-Tadpole-Eye-View
cd AI-Tadpole-Eye-View
pnpm install
pnpm gev dev          # http://localhost:5173 — keyless seed mode by default
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

- **Monorepo & Tooling:** Monorepo scaffold, Turborepo (`turbo.json`), Biome (`biome.json`), pnpm workspace.
- **`packages/contracts` (18 files):** Zod schemas for all feeds, ports, voice, collab, scene, tools, capabilities, and provider registry.
- **`packages/security` (5 files):** pinned-fetch (SSRF guard, TLS pinning, Overpass QL sanitizer, redirect rejection, byte caps).
- **`packages/core` (10 files):** cockpitMath, geoMath, scopeMask, sim-clock, scene serializer, XState voice machine, agent adapters, tool executor, collab intent doc.
- **`packages/governance` (5 files):** `SqliteAuditSink` (WAL + subscriber), `CapBudgetGovernor` (STASIS), `PromptApprovalGate`, `TadpoleM2Gatekeeper` (Ed25519), `MerkleAuditChain`.
- **`packages/providers` (12 files):** Typed provider registry, OpenSky, AIS, USGS, FIRMS, GBFS, Radio, CCTV, Launch, Weather, Cables (download pack), Overpass.
- **`packages/cesium-kit` (15 files):** Globe, BaseLayer, FlightLayer, MarineLayer, QuakeLayer, FirmsLayer, GbfsLayer, CctvLayer, RadioLayer, LaunchLayer, WeatherLayer, CollabLayer, DebugBus, FrameBudget.
- **`packages/ops-mcp` (3 files):** MCP server with full Zod-described tool set and sandboxed execution.
- **`packages/cli` (7 files):** `gev` command surface: `status`, `demo`, `audit`, `feeds`, `scene`, `resume`.
- **`apps/server` (18 files):** Hono server with provider proxy routes, CCTV media proxy, voice token route, collab WS, audit SSE, feed health endpoint, telemetry, cost governor & ops auth middleware.
- **`apps/web` (12 files):** Svelte 5 SPA: `App.svelte`, 7 HUD components, 3 Svelte rune stores (layers, voice, collab).
- **`e2e/smoke.spec.ts`:** Playwright smoke test (condition-waits only, no fixed sleeps).
- **`fixtures/` (9 datasets):** Recorded fixtures for implemented providers (including 1.25 MB OpenSky replay).
- **Architecture Decisions & Documentation:** ADRs 0014–0030, 0039 (18 decision records), DESIGN.md, SECURITY.md, RUNBOOK.md, DATA_SOURCES.md, AGENTS.md, PLAN.md.

### Partially built

- **Submarine cables UI:** `packages/providers/src/cables.ts` + contract schemas complete. Server route and `cesium-kit` layer not created; cables are not visible in the app.
- **T2 Collab:** Custom CRDT room manager with JWT tokens + WebSocket broadcast works. Yjs is a listed dependency but `y-websocket` server is not used; the CRDT sync is a custom protocol over raw WS.

### Not yet built (WIP Roadmap)

- **Satellites layer:** No provider file, no SGP4 / egm96 math in `core/`, no Cesium layer. Listed in PLAN.md section 8.
- **M4 Runtime:** Live autonomous AI agent process operating the running console via ops-mcp under governance.
- **T3 TAK/CoT bridge:** Post-parity roadmap item per PLAN.md section 9.
- **k6 load tests:** `load/` directory exists but contains no scripts. `check-bundle-budgets.mjs` exists but k6 runner not configured.
- **Full self-hosted telemetry stack:** GlitchTip / PostHog / Plausible referenced in PLAN.md. `ServerTelemetryManager` class exists in `apps/server` but external self-hosted services are not configured.

## Documentation

- [PLAN.md](./PLAN.md) — master build plan, phased roadmap, progress tracker (single source of truth)
- [AGENTS.md](./AGENTS.md) — how AI agents operate in this repo
- [SECURITY.md](./SECURITY.md) — threat model
- [DATA_SOURCES.md](./DATA_SOURCES.md) — dataset provenance, rate limits, and honest labeling
- [docs/LICENSES.md](./docs/LICENSES.md) — software, asset, and NC download pack licenses
- [RUNBOOK.md](./RUNBOOK.md) — operational procedures including STASIS recovery
- [docs/adr/INDEX.md](./docs/adr/INDEX.md) — Architecture Decision Records (ADRs 0014–0030, 0039)

## Ethics

Hard lines, inherited and sharpened from upstream: **no person-tracking, no face-recognition, no de-anonymization features.** Adjacent proposals (e.g., camera-location mapping) require a recorded human decision before any code is written. See section 12 of [PLAN.md](./PLAN.md).

## License

Code: **MIT**. Bundled datasets and 3D models carry their own licenses — non-commercial data ships as optional download packs, never bundled. Details in [docs/LICENSES.md](./docs/LICENSES.md) and [LICENSE](./LICENSE).

## Credits

Built on ideas and ported modules from [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (~7k stars). Governance runtime: [AI-TadPole-OS](https://github.com/DDS-Solutions/AI-TadPole-OS).