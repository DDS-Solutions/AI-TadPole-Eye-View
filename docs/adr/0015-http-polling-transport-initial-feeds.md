# ADR 0015: Client HTTP Polling Transport to Server-Side Cache for Initial Feeds

**Status:** Accepted · **Date:** 2026-08-26 · **Deciders:** Architecture Review

---

## Context & Problem Statement

PLAN.md Rule 4 prohibits client browsers from making direct connections to third-party data providers. Initial versions contemplated WebSocket/SSE push streaming infrastructure for flight feeds immediately. For a single feed in Phase 0, full WebSocket multiplexing adds connection management overhead, reconnect state machines, and proxy complexity without performance benefits over bounded HTTP polling.

## Decision

1. **Proxy Flow:** Browser connects strictly to Hono backend via `GET /api/flights?bbox=`.
2. **Server-Side Feed Ingestion:** Hono server queries provider adapters (`@gev/providers`) with pinned-fetch security guards and returns normalized `FlightBatch` responses.
3. **Client Polling Cadence:** Web client polls `/api/flights` at standard UI cadences (3–5s) and drains entity positions into `cesium-kit`'s `requestAnimationFrame` update queue.
4. **WebSocket/SSE Milestone:** Bidirectional streaming transport will be introduced in Phase 2 alongside multi-layer multiplexing.

## Consequences

- **Positive:** Zero browser leakage to external provider APIs. Simple, debuggable HTTP interfaces.
- **Positive:** Server-side caching prevents upstream API rate limit exhaustion.
