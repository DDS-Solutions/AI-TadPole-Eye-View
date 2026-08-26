# ADR 0019: Scene State Serialization & URL Deep-Linking Architecture

## Status
Accepted (2026-08-26)

## Context
PLAN.md §2 Law 8 establishes:
> "Scene is the universal unit of deep links, tests, bug reports, and sync."

To enable instant state reproduction across users, bug reports, and AI agent sessions, GEV v2 requires a lightweight, lossless, and URL-safe serialization format for the entire 3D globe state (camera pose, enabled layers, opacity, selected entity, AOI polygons, and sim-clock time offsets).

## Decision
1. **Contract-Enforced Encoding (`packages/core/src/sceneSerializer.ts`)**:
   - `serializeScene(scene: SceneState): string`: Enforces Zod contract parsing, serializes to JSON, and encodes to URL-safe base64url format without URL-hostile characters (`+`, `/`, `=`).
   - `deserializeScene(payload: string): SceneState`: Transparently decodes base64url or raw JSON and validates through `SceneState.parse()`.
   - `deserializeSceneSafe(payload, fallback)`: Defensive fallback returning default baseline if URL is corrupt or from an incompatible schema version.
2. **Deep-Link Protocol (`createSceneDeepLink` & `parseSceneFromUrl`)**:
   - Encodes state into URL hash fragments (`#scene=<base64url>`).
   - Hash fragments prevent sending state payloads to the backend server, maintaining client-side privacy while enabling instant browser bookmarking and sharing.
   - `apps/web/src/App.svelte` checks for `#scene=` on mount and automatically restores camera position, layer toggles, and AOIs.
3. **Idempotence & Property Testing**:
   - Property tests with `fast-check` verify lossless round-trip fidelity across arbitrary valid coordinate spaces and camera orientations.
   - Serialization and deserialization execute in sub-millisecond time (< 5ms SLA).

## Consequences
- **Positive**: Bug reports and test fixtures can capture and replay 100% exact globe states; deep links work seamlessly in any browser without backend persistence dependencies.
- **Trade-off**: Very large AOI coordinate arrays will produce longer URL hash strings.
