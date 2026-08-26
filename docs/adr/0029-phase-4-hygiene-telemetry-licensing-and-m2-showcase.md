# ADR 0029: Phase 4 Hygiene, Licensing Download Packs, Telemetry & Tadpole M2 Showcase

## Context

PLAN.md §10 Phase 4 establishes final repository hygiene, full geospatial layer provenance documentation, clean licensing isolation for non-commercial datasets, self-hosted telemetry with k6 proxy load verification, a live showcase demonstration of the governed agent team (M1–M3), and the Tadpole integration spike toward M2 with Ed25519 cryptographic approvals.

## Decision

1. **Layer Provenance Ethos:**
   - Authored dedicated provenance documentation for all 12 geospatial layers in `docs/data-sources/` and master `DATA_SOURCES.md`.
   - Explicitly documented upstream origins, license terms, update frequency, rate limits, and honest data labels (`LIVE`, `INTERPOLATED (RECONSTRUCTED ESTIMATE)`, `PROPAGATED SGP4 EPHEMERIS`, `SEED REPLAY (SIMULATED)`).

2. **Licensing Cleanliness & Non-Commercial Download Packs:**
   - Authored `docs/LICENSES.md` detailing software, data, and 3D asset licenses.
   - Enforced zero bundling of Non-Commercial (CC BY-NC-SA 4.0) data (TeleGeography submarine cables) in the Git tree.
   - Implemented `CablePackLoader` in `packages/providers/src/cables.ts` with a runtime license gate requiring explicit operator consent (`licenseAccepted: true`) and a synthetic procedural fallback for airgapped/seed environments.

3. **Self-Hosted Telemetry & k6 Proxy Load Verification:**
   - Implemented `ServerTelemetryManager` in `apps/server/src/telemetry/index.ts` tracking OpenTelemetry-compatible spans, GlitchTip error captures, and PostHog/Plausible anonymous metrics with PII redaction by construction.
   - Authored `load/k6-proxies.js` benchmarking server proxies and automated Vitest load test in `apps/server/test/load.test.ts` verifying concurrent requests complete with p95 < 50ms and 0% errors.

4. **Tadpole M2 Cryptographic Governance & Merkle WAL:**
   - Implemented `packages/governance/src/tadpoleBridge.ts` providing Ed25519 cryptographic key generation, digital signature creation/verification for `ApprovalResult` and `CapToken`, and `TadpoleM2Gatekeeper`.
   - Implemented `MerkleAuditChain` producing tamper-evident SHA-256 hash chains across SQLite WAL audit entries.

5. **Governed Agent Team Live Showcase:**
   - Implemented `packages/cli/src/commands/demo.ts` and `scripts/demo-scenario.ts` executing a live scripted demonstration of M1 Observer SSE streaming, governed tool executions, M3 Governor STASIS tripwire upon budget breach, and human operator recovery.

## Status

Accepted

## Consequences

- The GEV v2 repository achieves complete parity with all 13 upstream layers and completes Phase 4 deliverables.
- The monorepo remains commercially clean under MIT with zero bundled NC assets.
- Governance integration with AI-TadPole-OS is verified up to merge rung M2.
