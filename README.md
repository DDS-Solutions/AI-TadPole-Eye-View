# AI-Tadpole-Eye-View

> Watch the world live — then watch governed AI agents build and run the thing doing the watching.

[![Status](https://img.shields.io/badge/status-Early%20Stage%20WIP-orange)](./PLAN.md) [![Phase](https://img.shields.io/badge/phase-5.3%20(Operational%20Awareness)-blue)](./PLAN.md) [![Governance](https://img.shields.io/badge/governed%20by-AI--TadPole--OS-purple)](https://github.com/DDS-Solutions/AI-TadPole-OS) [![License](https://img.shields.io/badge/code-MIT-blue)](#license)

> ⚠️ **Project Status: Early Stage WIP (Work in Progress)**  
> This repository is an active, ground-up rewrite of [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) into an agent-native architecture designed for [AI-TadPole-OS](https://github.com/DDS-Solutions/AI-TadPole-OS) governance. Core telemetry layers, security perimeters, typed provider registries, and local governance work in seed mode. Shared M2 verification, M3 accounting, and a versioned SQLite audit chain are implemented locally; external production identity, Tadpole M4 orchestration, and remaining telemetry layers are still in development.

A live 3D OSINT console tracking **flights, ships, earthquakes, wildfires, bike transit, weather radar, public CCTV, radio, and submarine cables** on a photorealistic globe — designed from commit one so AI agents can develop, deploy, monitor, and debug it *alongside humans*, under enforceable governance (audit trails, approval gates, spend caps).

**Full build plan:** [PLAN.md](./PLAN.md) / [MASTER_PLAN_V3.md](./MASTER_PLAN_V3.md) | **AI operating manual:** [AGENTS.md](./AGENTS.md) | **Data provenance:** [DATA_SOURCES.md](./DATA_SOURCES.md) | **Licenses:** [docs/LICENSES.md](./docs/LICENSES.md)

---

## Why this repo exists

Two experiments in one project:

1. **A serious OSINT console.** Multi-layer live feeds, honest data labeling, keyless boot by default, privacy-first architecture.
2. **A governed AI dev team.** The repository is being built so humans and AI agents can share audited, approval-gated workflows under [AI-TadPole-OS](https://github.com/DDS-Solutions/AI-TadPole-OS). The SQLite WAL now redacts and bounds new audit content, links every retained row through the versioned `gev.audit.chain.v1` sidecar, and exposes fail-closed integrity inspection.

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
| 🛰️ Satellites | CelesTrak standard GP JSON/OMM | ACTIVE (SEED) / LIVE LOCKED | Synthetic seed → server SGP4 → Cesium layer is implemented. Production retrieval remains terms-locked under ADR 0034; raw catalog mirroring and live-position claims are prohibited. |
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
- **Security by construction:** Product outbound HTTP goes through an SSRF-guarded, TLS-pinned fetcher with mandatory timeouts and byte limits (`packages/security`). Local MCP scene I/O is root-confined and size-bounded; the remaining collaboration boundaries are explicitly tracked as hardening work.

## Governance (the AI-Tadpole-OS seam)

The repository defines five governance ports. Durable local governance and signed-approval verification exist, while external production integrations remain unfinished:

| Rung | Capability | Status | Honest Notes |
|---|---|---|---|
| **M1 Observer** | Authenticated audit stream (`/ops/audit`) + feed health | PARTIAL | `SqliteAuditSink` has durable hash-chain verification and protected integrity inspection; external authenticated/resumable observer proof is incomplete. |
| **M2 Gatekeeper** | Signed approval controls mutations | VERIFIER IMPLEMENTED; PROVIDER UNCONFIGURED | `SignedApprovalGate` verifies exact intent/scopes/signer/key/nonce/time bindings and consumes replay state in shared SQLite. Production denies without an injected trusted provider/key allowlist; `LocalM2ApprovalDemoGate` is non-production only. |
| **M3 Governor** | Shared budget ledger + durable STASIS | LOCAL M3 IMPLEMENTED | Reservation, settlement, refund, retry, ambiguity, reconciliation, and human-only resume are transactionally shared through SQLite. External Tadpole/production integration remains unfinished. |
| **M4 Runtime** | Real AI agent team operates the live console end-to-end under governance | NOT YET REACHED (WIP) | `gev demo` simulates M1–M3 in-process (CLI only). M4 = an actual agent process driving a running server via ops-mcp under live governance — in progress. |

> **Truth note on the demo:** `gev demo` exercises local M1–M3-shaped mechanics, verifies the durable SQLite audit chain, and also displays a disconnected shadow-hash helper for illustration. It does not prove an external production approval provider, external M3 authority, independently anchored audit heads, or a live agent team controlling the globe.

The current governor persists **STASIS** across local processes. An offline CLI result remains a non-authoritative snapshot, and production signer identity/transport must not be inferred from the local demo.

## Quick start

```bash
git clone https://github.com/DDS-Solutions/AI-Tadpole-Eye-View
cd AI-Tadpole-Eye-View
pnpm install
pnpm build            # required once after a fresh clone; builds the CLI and workspace packages
pnpm gev dev          # http://localhost:5173 — keyless seed mode by default
```

Run tests, showcase demonstration, and health diagnostics:

```bash
pnpm gev status       # inspect phase, STASIS, budget, and feeds
pnpm gev audit verify # verify the connected or read-only local audit chain; never repair
pnpm gev demo         # run M1-M3 governance showcase (CLI simulation, not live agent)
pnpm gev test         # run complete unit and property test suites
node scripts/adg.mjs  # run Active Documentation Guard
```

## What is built vs what is pending

### Fully built

- **Monorepo & Tooling:** Monorepo scaffold, Turborepo (`turbo.json`), Biome (`biome.json`), pnpm workspace.
- **`packages/contracts`:** Zod schemas for feeds, ports, voice, collaboration, scenes, tools, capabilities, and the provider registry.
- **`packages/security`:** pinned-fetch, SSRF defense, TLS socket pinning, the Overpass QL sanitizer, redirect rejection, and byte caps.
- **`packages/core`:** pure math/domain modules, sim-clock, scene serialization, voice state machine, agent adapters, tool executor, and collaborative intent document.
- **`packages/governance`:** shared SQLite audit chain, redaction and signed retention boundaries, M2 verifier/replay state, durable M3 ledger/STASIS, local approval stubs, and Ed25519 helpers.
- **`packages/providers`:** typed provider registry plus OpenSky, AIS, USGS, FIRMS, GBFS, Radio, CCTV, Launch, Weather, Cables, and Overpass adapters.
- **`packages/cesium-kit`:** imperative globe and layer controllers, debug bus, and frame-budget monitor.
- **`packages/ops-mcp`:** hand-written stdio MCP server exposing seven verified local tools. Browser-console-only tools are not advertised or executable over stdio; scene I/O is filename-only, size-bounded, and atomic beneath `.gev/scenes` (override with `GEV_MCP_SCENE_ROOT`).
- **`packages/cli`:** `gev` command surface for status, demo, audit, feeds, scenes, resume, development, tests, and QA.
- **`apps/server`:** Hono provider proxies, media/voice/collaboration routes, audit SSE, feed health, telemetry, cost governor, and operations auth.
- **`apps/web`:** Svelte 5 SPA and tactical HUD backed by Cesium layer controllers.
- **`e2e/smoke.spec.ts`:** condition-wait Playwright smoke coverage exists; its current teardown timeout is tracked by task 5.0.5.
- **`fixtures/` (9 datasets):** Recorded fixtures for implemented providers (including 1.25 MB OpenSky replay).
- **Architecture Decisions & Documentation:** ADRs 0014–0030 and 0039–0044 (23 decision records), DESIGN.md, SECURITY.md, RUNBOOK.md, DATA_SOURCES.md, AGENTS.md, PLAN.md.

### Partially built

- **Submarine cables UI:** `packages/providers/src/cables.ts` + contract schemas complete. Server route and `cesium-kit` layer not created; cables are not visible in the app.
- **T2 Collab:** Custom CRDT room manager with JWT tokens + WebSocket broadcast works. Yjs is a listed dependency but `y-websocket` server is not used; the CRDT sync is a custom protocol over raw WS.

### Not yet built (WIP Roadmap)

- **Satellites layer:** No provider file, no SGP4 / egm96 math in `core/`, no Cesium layer. Listed in PLAN.md section 8.
- **M4 Runtime:** Live autonomous AI agent process operating the running console via ops-mcp under governance.
- **T3 TAK/CoT bridge:** Post-parity roadmap item per PLAN.md section 9.
- **k6 expansion:** `load/k6-proxies.js` exists with proxy thresholds; broader scenarios and CI execution are still pending.
- **Full self-hosted telemetry stack:** GlitchTip / PostHog / Plausible referenced in PLAN.md. `ServerTelemetryManager` class exists in `apps/server` but external self-hosted services are not configured.

## Documentation

- [PLAN.md](./PLAN.md) / [MASTER_PLAN_V3.md](./MASTER_PLAN_V3.md) — Master Implementation Plan V3, phased roadmap, progress tracker, and deterministic resume protocol (single source of truth with ADR 0030 synchronized mirror)
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
