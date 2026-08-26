# AI-Tadpole-Eye-View

> Watch the world live — then watch governed AI agents build and run the thing doing the watching.

<!-- TODO(Phase 0): hero screenshot or 15s GIF — globe with flights layer + copilot cursor visible -->

[![Status](https://img.shields.io/badge/status-pre--scaffold-orange)]() [![License](https://img.shields.io/badge/code-MIT-blue)](#license) [![Governed by](https://img.shields.io/badge/governed%20by-AI--TadPole--OS-purple)](https://github.com/DDS-Solutions/AI-TadPole-OS)

A live 3D OSINT console tracking **flights, ships, satellites, earthquakes, fires, public CCTV and radio** on a photorealistic globe — rebuilt ground-up from [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) as an **agent-native codebase**: designed from commit one so AI agents can develop, deploy, monitor, and debug it *alongside humans*, under enforceable governance (audit trails, approval gates, spend caps).

**📖 Full build plan:** [PLAN.md](./PLAN.md) · **🤖 AI operating manual:** [AGENTS.md](./AGENTS.md)

---

## Why this repo exists

Two experiments in one project:

1. **A serious OSINT console.** Thirteen live data layers, honest data labeling, keyless boot by default, privacy-first architecture.
2. **A governed AI dev team.** Every feature you see was built, tested, and operated by autonomous AI agents working under [AI-TadPole-OS](https://github.com/DDS-Solutions/AI-TadPole-OS) oversight — with a tamper-evident audit trail proving it.

Most agent demos show swarm diagrams. This one shows a working product and the receipts for how it got there.

## Features

| Layer | Source | Status |
|---|---|---|
| ✈️ Flights | OpenSky · adsb.lol | 🟡 Phase 0–1 |
| 🚢 Ships | AISStream | ⚪ Planned |
| 🛰️ Satellites | SGP4 propagation | ⚪ Planned |
| 🌍 Quakes | USGS · EMSC | ⚪ Planned |
| 🔥 Fires | FIRMS | ⚪ Planned |
| 📷 Public CCTV | Server-registered URLs | ⚪ Planned |
| 📻 Radio | Radio Browser | ⚪ Planned |
| 🚀 Launch replays | Modeled (labeled as such) | ⚪ Planned |
| 🚲 Transit (GBFS) | GBFS feeds | ⚪ Planned |
| 🎙️ AI voice copilot | OpenAI Realtime · OpenRouter · Ollama | ⚪ Phase 3 |

**Keyless boot:** the globe works with zero API keys out of the box (MapLibre/PMTiles fallback). Google Photorealistic 3D Tiles are an optional enhancement, never a gate.

## Architecture

```
[Browser: GEV v2 UI] ──┐
                       ├──► [Hono server] ──► providers (OpenSky, AIS, FIRMS…)
[Tadpole console] ─────┘         │
                                 ├─ ops API + SSE audit stream
                                 └─ governance ports: AuditSink · ApprovalGate ·
                                    BudgetGovernor · CapabilityIssuer · AgentEnvelope
```

- **Monorepo:** `apps/web` (Svelte 5) · `apps/server` (Hono) · `packages/{contracts, core, security, providers, cesium-kit, ops-mcp, governance, cli}`
- **Contracts-first:** Zod schemas define REST payloads, websocket messages, and AI tool definitions from one source of truth.
- **Security by construction:** every outbound fetch goes through an SSRF-guarded, TLS-pinned fetcher with mandatory timeouts. Unbounded requests are unrepresentable.

## Governance (the Tadpole seam)

AI actions in this repo run under five enforced ports — local stubs today, [AI-TadPole-OS](https://github.com/DDS-Solutions/AI-TadPole-OS) implementations at each merge rung:

| Rung | Capability | Status |
|---|---|---|
| **M1 Observer** | Tadpole reads the live audit stream + feed health | ⚪ |
| **M2 Gatekeeper** | Mutating ops require signed approvals | ⚪ |
| **M3 Governor** | Budget enforcement + STASIS lockdown | ⚪ |
| **M4 Runtime** | Agent team operates the console end-to-end | ⚪ |

Spend caps trip **STASIS** — all agents suspend until a human resumes them. No self-resume. Ever.

## Quick start

> ⚠️ Pre-scaffold — commands below land with Phase 0.

```bash
git clone https://github.com/DDS-Solutions/AI-Tadpole-Eye-View
cd AI-Tadpole-Eye-View
pnpm install
pnpm gev dev          # http://localhost:xxxx — no keys required
```

Optional keys (`.env`) unlock: Google Photorealistic 3D Tiles, OpenAI Realtime voice, higher OpenSky rate limits. Everything else runs keyless.

## Documentation

- [PLAN.md](./PLAN.md) — master build plan, phased roadmap, progress tracker *(single source of truth)*
- [AGENTS.md](./AGENTS.md) — how AI agents operate in this repo
- [SECURITY.md](./SECURITY.md) — threat model
- [RUNBOOK.md](./RUNBOOK.md) — operational procedures incl. STASIS recovery
- [docs/data-sources/](./docs/data-sources/) — provenance per dataset

## Ethics

Hard lines, inherited and sharpened from upstream: **no person-tracking, no face-recognition, no de-anonymization features.** Adjacent proposals (e.g., camera-location mapping) require a recorded human decision before any code is written. See §12 of [PLAN.md](./PLAN.md).

## License

Code: **MIT**. Bundled datasets and 3D models carry their own licenses — non-commercial data ships as optional download packs, never bundled. Details in [LICENSE](./LICENSE) and [docs/data-sources/](./docs/data-sources/).

## Credits

Built on ideas and ported modules from [`bilawalsidhu/gods-eye-view`](https://github.com/bilawalsidhu/gods-eye-view) (~2k ⭐) — exceptional engineering including its SSRF defenses, OverpassQL sanitizer, and cost governor. Governance runtime: [`AI-TadPole-OS`](https://github.com/DDS-Solutions/AI-TadPole-OS).
```

