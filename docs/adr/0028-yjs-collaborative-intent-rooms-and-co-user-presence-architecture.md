# ADR 0028: Yjs Collaborative Intent Rooms & Co-User Presence Architecture

## Status
Accepted

## Date
2026-08-26

## Context
Phase 3 establishes the **T2 Live Co-Op Multiplayer Tier** (PLAN.md §9). In high-density global OSINT scenarios (e.g. 10,000+ flights and ships updating at 60 FPS), synchronizing full telemetry streams across peers over CRDTs would overwhelm network bandwidth and introduce unacceptable rendering jitter.

## Decision
1. **Sync Intent, Never Telemetry (PLAN.md §9):**
   The 10k-entity telemetry stream remains strictly in the local rAF pipeline. The Yjs CRDT document (`CollabIntentDoc`) synchronizes only operator intent:
   - Selected entity reference (`{ layer: string, id: string }`).
   - Active layer visibility toggles (`Record<string, boolean>`).
   - Area of Interest (AOI) polygon annotations.
   - Simulation time offset and follow-leader tracking references.
2. **Ephemeral Rooms & Signed JWT Tokens:**
   `apps/server` mounts `CollabRoomManager` on `/api/collab`. `POST /api/collab/join` issues signed JWT tokens (`jose`) scoped to the room and callsign. Rooms are held in memory with automatic TTL teardown on idle.
3. **Presence Awareness & Remote Frustums:**
   Ephemeral presence frames broadcast 20Hz cursor positions and 10Hz camera poses. `CollabLayerController` in `@gev/cesium-kit` renders glowing remote operator cursors with callsign billboards and smoothly handles follow-leader camera sync.
4. **AI Co-User Presence:**
   The Tactical Voice Agent and AI Co-User participate as visible peers in the room, broadcasting tool actions and viewport adjustments to all connected operators.

## Consequences
- Ultra-low bandwidth consumption regardless of global entity density.
- Seamless multi-operator collaboration with callsign privacy by construction.
- No direct browser-to-browser WebRTC signaling required for baseline live co-op.
