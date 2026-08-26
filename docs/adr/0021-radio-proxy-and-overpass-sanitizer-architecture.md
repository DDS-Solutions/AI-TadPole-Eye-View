# ADR 0021: Radio Stream Proxy & Overpass QL Sanitizer Architecture

## Status
Accepted (2026-08-26)

## Context
PLAN.md §10 Phase 1 Items 3 & 4 mandate:
1. **Radio & ATC Stream Proxy**: Providing real-time ATC and marine VHF radio streams with TLS pinning, SSRF protection, and stream catalog health policies.
2. **Overpass QL Sanitizer**: Sanitizing OpenStreetMap Overpass QL queries to prevent Denial of Service (DoS), infinite regular expressions (ReDoS), and unbounded queries that overwhelm browser memory or upstream OSM servers.

## Decision
1. **Radio Proxy Architecture (`packages/contracts/src/radio.ts`, `apps/server/src/routes/radio.ts`)**:
   - `GET /api/radio/catalog`: Returns frequency catalog with category (`atc`, `marine`, `emergency`, `broadcast`) and bounding box filters.
   - `GET /api/radio/stream/:id`: Proxies audio streams via `pinnedFetch` with strict domain allowlists (`audio.broadcastify.com`, `liveatc.net`, `radio-browser.info`), non-blocking stream chunking, and connection lifecycle abort handlers.
2. **Overpass QL Sanitizer (`packages/security/src/overpassSanitizer.ts`)**:
   - **Timeout Clamping**: Clamps `[timeout:N]` to $[1, 25]$ seconds.
   - **Mandatory Bounding Box & Area Caps**: Requires a bounding box constraint (`[bbox:s,w,n,e]` or statement filter) with a maximum span of $5.0^\circ \times 5.0^\circ$ (25 sq deg) to prevent full-planet memory exhaustion.
   - **ReDoS Prevention**: Analyzes regular expression filters for nested or unbounded quantifiers (`(a+)+`) and rejects vulnerable queries.
   - **Complexity Scoring**: Computes a 1-100 complexity metric based on statement count, geographic area, and regex filters.

## Consequences
- **Positive**: Complete defense against unbounded OSM queries and ReDoS exploits; reliable, TLS-pinned audio proxying for ATC and maritime VHF channels.
- **Trade-off**: Overpass queries spanning $> 5^\circ$ must be broken down into tiled sub-queries.
