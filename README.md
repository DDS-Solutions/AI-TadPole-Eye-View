# AI-Tadpole-Eye-View

> Watch the world live — then watch governed AI agents build and run the thing doing the watching.

[![Status](https://img.shields.io/badge/status-phase%203%20complete-brightgreen)]() [![License](https://img.shields.io/badge/code-MIT-blue)](#license) [![Governed by](https://img.shields.io/badge/governed%20by-AI--TadPole--OS-purple)](https://github.com/DDS-Solutions/AI-TadPole-OS)

A live 3D OSINT console tracking **flights, ships, satellite launches, earthquakes, wildfires, bike transit, weather radar, public CCTV and radio** on a photorealistic globe — rebuilt ground-up from [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) as an **agent-native codebase**: designed from commit one so AI agents can develop, deploy, monitor, and debug it *alongside humans*, under enforceable governance (audit trails, approval gates, spend caps).

**📖 Full build plan:** [PLAN.md](./PLAN.md) · **🤖 AI operating manual:** [AGENTS.md](./AGENTS.md)

---

## Why this repo exists

Two experiments in one project:

1. **A serious OSINT console.** Multi-layer live feeds, honest data labeling, keyless boot by default, privacy-first architecture.
2. **A governed AI dev team.** Every feature was built, tested, and operated by autonomous AI agents working under [AI-TadPole-OS](https://github.com/DDS-Solutions/AI-TadPole-OS) oversight — with a tamper-evident audit trail proving it.

Most agent demos show swarm diagrams. This one shows a working product and the receipts for how it got there.

## Features

| Layer | Source | Status |
|---|---|---|
| ✈️ Flights | OpenSky Network | 🟢 Active (Phase 0–1) |
| 🚢 Ships | AISStream | 🟢 Active (Phase 2) |
| 🌍 Earthquakes | USGS Earthquake API | 🟢 Active (Phase 2) |
| 🔥 Wildfires | NASA FIRMS | 🟢 Active (Phase 2) |
| 🚲 Bike Transit | GBFS Standard Feeds | 🟢 Active (Phase 2) |
| 📷 Public CCTV | DOT Traffic Camera Feeds | 🟢 Active (Phase 2) |
| 📻 Live Radio | Broadcastify Police/Fire Audio | 🟢 Active (Phase 2) |
| 🚀 Orbital Trajectories | Launch Dashboard Feeds | 🟢 Active (Phase 2) |
| 🌧️ Weather Radar | RainViewer Precipitation Radar | 🟢 Active (Phase 2) |
| 🎙️ AI Voice Copilot | OpenAI Realtime · Seed/Mock Driver | 🟢 Active (Phase 3) |
| 👥 T2 Live Co-Op | Yjs CRDT Rooms + Presence Cursors | 🟢 Active (Phase 3) |

**Keyless boot:** the globe works with zero API keys out of the box using local recorded fixtures and OpenStreetMap raster tiles. Google Photorealistic 3D Tiles and live provider streams are optional enhancements, never a gate.

## Architecture

```
[Browser: GEV v2 UI] ──┐
                       ├──► [Hono server] ──► providers (OpenSky, AIS, FIRMS…)
[Tadpole console] ─────┘         │
                                 ├─ ops API + SSE audit stream
                                 ├─ Yjs collaborative intent rooms (/api/collab)
                                 ├─ ephemeral voice session tokens (/api/voice)
                                 └─ governance ports: AuditSink · ApprovalGate ·
                                    BudgetGovernor · CapabilityIssuer · AgentEnvelope
```

- **Monorepo:** `apps/web` (Svelte 5 SPA) · `apps/server` (Hono API & WebSocket Server) · `packages/{contracts, core, security, providers, cesium-kit, ops-mcp, governance, cli}`
- **Contracts-first:** Zod schemas define REST payloads, WebSocket messages, collaborative intent documents, and AI tool definitions from a single source of truth.
- **Security by construction:** Every outbound fetch goes through an SSRF-guarded, TLS-pinned fetcher with mandatory timeouts. Unbounded requests are unrepresentable.

## Governance (the Tadpole seam)

AI actions in this repo run under five enforced ports — local stubs today, [AI-TadPole-OS](https://github.com/DDS-Solutions/AI-TadPole-OS) implementations at each merge rung:

| Rung | Capability | Status |
|---|---|---|
| **M1 Observer** | Tadpole reads the live audit stream (`/ops/audit`) + feed health | 🟢 Verified |
| **M2 Gatekeeper** | Mutating ops require signed approvals (`ApprovalGate`) | 🟢 Verified |
| **M3 Governor** | Budget enforcement + STASIS lockdown (`BudgetGovernor`) | 🟢 Verified |
| **M4 Runtime** | Agent team operates the console end-to-end | ⚪ Phase 4 |

Spend caps trip **STASIS** — all agents suspend until a human resumes them. No self-resume. Ever.

## Quick start

```bash
git clone https://github.com/DDS-Solutions/AI-Tadpole-Eye-View
cd AI-Tadpole-Eye-View
pnpm install
pnpm gev dev          # http://localhost:5173 — keyless seed mode by default
```

Run tests and health diagnostics:
```bash
pnpm gev status       # inspect phase, STASIS, budget, and feeds
pnpm gev test         # run complete unit & property test suites
node scripts/adg.mjs  # run Active Documentation Guard
```

## Documentation

- [PLAN.md](./PLAN.md) — master build plan, phased roadmap, progress tracker *(single source of truth)*
- [AGENTS.md](./AGENTS.md) — how AI agents operate in this repo
- [SECURITY.md](./SECURITY.md) — threat model
- [RUNBOOK.md](./RUNBOOK.md) — operational procedures incl. STASIS recovery
- [docs/adr/INDEX.md](./docs/adr/INDEX.md) — Architecture Decision Records (ADRs 0014–0028)

## Ethics

Hard lines, inherited and sharpened from upstream: **no person-tracking, no face-recognition, no de-anonymization features.** Adjacent proposals (e.g., camera-location mapping) require a recorded human decision before any code is written. See §12 of [PLAN.md](./PLAN.md).

## License

Code: **MIT**. Bundled datasets and 3D models carry their own licenses — non-commercial data ships as optional download packs, never bundled. Details in [LICENSE](./LICENSE).

## Credits

Built on ideas and ported modules from [`bilawalsidhu/gods-eye-view`](https://github.com/bilawalsidhu/gods-eye-view) (~2k ⭐). Governance runtime: [`AI-TadPole-OS`](https://github.com/DDS-Solutions/AI-TadPole-OS).
