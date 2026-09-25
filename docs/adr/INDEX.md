# Architecture Decision Records (ADR) Index

This directory records all significant architectural and structural decisions made across the GEV v2 project.

---

| ADR | Title | Status | Date |
|---|---|---|---|
| [0014](./0014-cesium-osm-raster-keyless-baseline.md) | CesiumJS with ion-free OpenStreetMap raster imagery as keyless default baseline | Accepted | 2026-08-26 |
| [0015](./0015-http-polling-transport-initial-feeds.md) | Client HTTP polling transport to server-side cache for initial feed layers | Accepted | 2026-08-26 |
| [0016](./0016-node-sqlite-governance-audit-wal.md) | Built-in node:sqlite for local governance AuditSink write-ahead log (WAL) | Accepted | 2026-08-26 |
| [0017](./0017-mcp-server-and-cli-architecture.md) | Operator MCP Server & Unified gev CLI Surface | Accepted | 2026-08-26 |
| [0018](./0018-active-documentation-guard-and-runbook-architecture.md) | Active Documentation Guard (ADG) & Operational Runbook Architecture | Accepted | 2026-08-26 |
| [0019](./0019-scene-serializer-and-deep-link-architecture.md) | Scene State Serialization & URL Deep-Linking Architecture | Accepted | 2026-08-26 |
| [0020](./0020-server-proxies-and-cost-governor-architecture.md) | Server Telemetry Proxies & Cost Governor Architecture | Accepted | 2026-08-26 |
| [0021](./0021-radio-proxy-and-overpass-sanitizer-architecture.md) | Radio Stream Proxy & Overpass QL Sanitizer Architecture | Accepted | 2026-08-26 |
| [0022](./0022-cctv-media-proxy-voice-tokens-and-m1-audit-stream.md) | CCTV Media Proxy, Realtime Voice Tokens & M1 Audit Stream Architecture | Accepted | 2026-08-26 |
| [0023](./0023-telemetry-layer-controllers-and-tactical-hud-architecture.md) | Telemetry Layer Controllers & Tactical HUD Architecture | Accepted | 2026-08-26 |
| [0024](./0024-media-telemetry-layers-and-live-streaming-hud-architecture.md) | Media Telemetry Layers, Orbital Trajectories & Live Streaming HUD Architecture | Accepted | 2026-08-26 |
| [0025](./0025-performance-budgets-frame-harness-and-virtualized-telemetry.md) | Performance Budgets, Frame-Time Harness & Virtualized Telemetry Architecture | Accepted | 2026-08-26 |
| [0026](./0026-provider-agnostic-voice-agent-and-xstate-lifecycle-architecture.md) | Provider-Agnostic Voice Agent & XState Lifecycle Architecture | Accepted | 2026-08-26 |
| [0027](./0027-shared-tool-registry-contracts-and-governed-actuators-architecture.md) | Shared Tool Registry Contracts & Governed Actuators Architecture | Accepted | 2026-08-26 |
| [0028](./0028-yjs-collaborative-intent-rooms-and-co-user-presence-architecture.md) | Yjs Collaborative Intent Rooms & Co-User Presence Architecture | Accepted | 2026-08-26 |
| [0029](./0029-phase-4-hygiene-telemetry-licensing-and-m2-showcase.md) | Phase 4 Hygiene, Licensing Download Packs, Telemetry & Tadpole M2 Showcase | Accepted | 2026-08-26 |
| [0030](./0030-plan-v3-canonical-resume-and-mirror.md) | V3 canonical plan and deterministic resume checkpoint | Accepted | 2026-08-27 |
| [0031](./0031-authentication-identity-tenancy-route-policy.md) | Authentication, identity, tenancy, and route policy | Accepted; production provisioning pending and fail-closed | 2026-09-14 |
| [0032](./0032-mcp-sdk-transport-protocol-session-design.md) | Incremental official MCP SDK adoption with preserved stdio compatibility | Accepted; default-off; cancellation repaired; Phase 6 exit certified | 2026-09-08 |
| [0034](./0034-celestrak-gp-omm-satellite-source-policy.md) | CelesTrak GP/OMM satellite source and access policy | Accepted | 2026-09-04 |
| [0035](./0035-provenance-contract-and-freshness-policy.md) | Versioned provenance contract and registry-owned freshness policy | Accepted | 2026-08-29 |
| [0036](./0036-cable-fixture-and-licensed-pack-policy.md) | Cable fixture and operator-licensed pack policy | Accepted | 2026-08-30 |
| [0039](./0039-language-placement-and-runtime-boundaries.md) | Language placement and runtime boundaries | Accepted | 2026-08-27 |
| [0040](./0040-architectural-drift-inventory-and-follow-up-gates.md) | Architectural drift inventory and follow-up gates | Accepted | 2026-08-28 |
| [0041](./0041-durable-shared-governance-runtime.md) | Durable shared governance runtime | Accepted | 2026-08-28 |
| [0042](./0042-signed-m2-approval-verification.md) | Signed M2 approval verification | Accepted (provisional integration profile) | 2026-08-28 |
| [0043](./0043-m3-ledger-reservation-settlement-and-reconciliation.md) | M3 ledger reservation, settlement, refund, and reconciliation | Accepted | 2026-08-28 |
| [0044](./0044-versioned-sqlite-audit-chain-redaction-and-retention.md) | Versioned SQLite audit chain, redaction, and retention boundaries | Accepted | 2026-08-29 |
| [0045](./0045-operational-awareness-source-and-access-policy.md) | Operational-awareness source and access policy | Accepted | 2026-09-05 |
| [0046](./0046-operational-awareness-rendering-and-architecture-baseline.md) | Operational-awareness rendering and architecture baseline | Accepted | 2026-09-05 |
| [0047](./0047-coastal-and-tropical-operational-awareness-baseline.md) | Coastal and tropical operational-awareness baseline | Accepted | 2026-09-06 |
| [0048](./0048-bounded-operational-imagery-spike.md) | Bounded operational-imagery spike | Accepted | 2026-09-06 |
| [0049](./0049-registry-derived-layer-access-read-model.md) | Registry-derived Layer Access read model | Accepted | 2026-09-06 |
| [0050](./0050-tenant-quota-rate-cache-killswitch-policy.md) | Tenant Quota, Rate Limit, Cache Partitioning, and Kill-Switch Policy | Accepted | 2026-09-15 |
| [0051](./0051-lazy-intelligence-route-and-cesium-bundle-decoupling.md) | Lazy intelligence route and Cesium bundle decoupling architecture | Accepted | 2026-09-15 |
| [0052](./0052-economic-analysis-package-path-and-architecture.md) | Economic analysis workspace package path and pure domain architecture | Accepted | 2026-09-16 |
| [0053](./0053-protected-stateless-economic-preview-api-and-mcp-tool.md) | Protected stateless economic preview API and MCP operator tool through shared governance | Accepted | 2026-09-16 |
| [0054](./0054-content-instruction-separation-and-prompt-injection-defense.md) | Content/instruction separation and prompt-injection defense | Accepted | 2026-09-16 |
| [0055](./0055-census-acs-variable-dictionary-and-adapter-architecture.md) | Census ACS variable dictionary, boundary contracts, and seed adapter architecture | Accepted | 2026-09-21 |
| [0056](./0056-census-cbp-zbp-adapter-architecture.md) | Census CBP & ZBP variable dictionary, boundary contracts, disclosure suppression preservation, and seed adapter architecture | Accepted | 2026-09-21 |
| [0057](./0057-osm-commercial-enrichment-adapter-architecture.md) | OpenStreetMap commercial enrichment adapter, boundary contracts, sanitizer integration, ODbL attribution, and seed pipeline | Accepted | 2026-09-21 |
| [0058](./0058-deterministic-market-competition-and-location-comparison-analysis.md) | Deterministic market, competition, and location-comparison analysis, source-linked disagreement preservation, and multi-source evidence bundles | Accepted | 2026-09-21 |
| [0059](./0059-protected-market-analysis-apis-mcp-tools-and-lazy-ui.md) | Protected market analysis REST endpoints, governed MCP operator tools, and lazy market HUD/UI inspection components | Accepted | 2026-09-21 |
| [0060](./0060-bls-oews-and-lau-workforce-adapters-architecture.md) | BLS OEWS and LAU workforce adapters, variable dictionaries, suppression preservation, anti-PII defense, and seed adapter architecture | Accepted | 2026-09-24 |

