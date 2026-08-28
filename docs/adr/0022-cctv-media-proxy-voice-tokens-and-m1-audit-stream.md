# ADR 0022: CCTV Media Proxy, Realtime Voice Tokens & M1 Audit Stream Architecture

## Status
Accepted (2026-08-26)

## Context
PLAN.md §10 Phase 1 Items 5, 6, 7, and 8 complete the server parity tier:
1. **CCTV Media Proxy**: Traffic camera snapshot and stream proxying with timeout lifecycle and SSRF bounds.
2. **Realtime Voice Tokens**: Ephemeral client-secret (`ek_...`) provisioning for OpenAI Realtime voice agents with auth-default controls.
3. **Feed Health & Telemetry**: Diagnostic endpoint reporting latency, error rates, and `traceparent`-compatible correlation. Official OpenTelemetry packages are not installed; the local telemetry ring buffer is compatibility-oriented, not an OTel SDK/exporter deployment.
4. **M1 Observer Merge-Rung**: Server-Sent Events (SSE) live audit stream enabling external agent governance runtimes (Tadpole OS) to observe GEV audit logs in real-time.

## Decision
1. **CCTV Media Proxy (`apps/server/src/routes/cctv.ts`)**:
   - `GET /api/cctv/catalog`: Returns camera catalog with agency and geographic filters.
   - `GET /api/cctv/snapshot/:id`: Proxies static snapshot images with 8-second hard timeout, 5MB response cap, and domain pinning across DOT endpoints (`cctv.dot.ca.gov`, `nyctmc.org`, `jamcams.tfl.gov.uk`).
2. **OpenAI Voice Token Provisioning (`apps/server/src/routes/voice.ts`)**:
   - `POST /api/voice/session`: Issues ephemeral `ek_` tokens for client-side WebRTC voice sessions. Enforces bearer authorization when `GEV_REQUIRE_AUTH=1`.
3. **Feed Health & Telemetry (`apps/server/src/routes/health.ts`)**:
   - `GET /api/feeds/health`: Reports health status across all 8 provider feeds with `traceparent` context.
4. **M1 Observer SSE Audit Stream (`apps/server/src/routes/auditStream.ts`)**:
   - `GET /ops/audit/stream`: Real-time Server-Sent Events stream delivering `GevEvents` (`audit.intent`, `audit.outcome`) with initial tail history and periodic heartbeats.

## Consequences
- **Positive**: Complete server parity with upstream GODS-EYE-VIEW architecture; zero external network calls in seed mode; complete durability and external audit observability for Tadpole OS.
- **Phase 1 Complete**: All 8 items of Phase 1 are implemented, tested, and verified.
