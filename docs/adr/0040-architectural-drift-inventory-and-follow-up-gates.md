# ADR 0040 — Architectural drift inventory and follow-up gates

**Status:** Accepted

**Date:** 2026-08-28
**Task:** PLAN.md 5.0.6

## Context

Task 5.0.6 requires a deterministic repository-wide inventory of direct wall-clock
use, source files over 500 lines, hardcoded design colors, simultaneous `cesium` and
`@cesium/engine` dependencies, and documentation claims for stack items absent from
package manifests. Mechanical replacement or dependency removal would be unsafe
without ownership and measured rendering/bundle evidence.

The machine-readable inventory is
[`docs/architecture/architectural-drift.json`](../architecture/architectural-drift.json).
`pnpm architecture:check` recomputes every category, rejects unclassified findings,
and requires exact color fingerprints, line counts, manifests, import counts, and
installed-stack truth.

## Decision

### Injected time

Task 5.0.6 routes governance, provider, server, voice, collaboration, HUD, and Cesium
selection timestamps through `SimClock`. It also makes mock tool-call IDs deterministic.
The remaining direct clock sites are compliant infrastructure:

- `SystemClock`, the sole wall-clock implementation;
- Cesium frame-budget measurement;
- offline ADG duration measurement; and
- a CLI-generated default filename when the operator omits one.

Any new direct clock path is unclassified and fails the inventory check.

### Files over 500 lines

The following temporary ADR exemptions are exact, not directory-wide waivers:

| File | Lines at acceptance | Owner and mandatory split gate |
|---|---:|---|
| `apps/web/src/App.svelte` | 566 | Web/Cesium owners; extract feed orchestration before its next feature edit or task 5.2.2/5.2.3 wiring |
| `apps/web/src/components/EntityInfoCard.svelte` | 502 | Web UI owner; extract entity-kind presenters before its next feature edit |
| `apps/web/src/components/LayerControlPanel.svelte` | 690 | Web UI owner; extract per-channel controls before its next feature edit |
| `apps/web/src/components/VirtualizedTelemetryTable.svelte` | 525 | Web UI owner; resolve TanStack-versus-manual windowing and split controls/rows before task 7.3 or its next feature edit |
| `packages/contracts/src/tools.ts` | 541 | Contracts/MCP owners; split schemas, metadata, and projections in task 5.1.2 before registry expansion |

The checker fails when any count changes, a listed file disappears without inventory
reconciliation, or another source file crosses 500 lines.

### Design colors

Cesium controller colors now come from one `packages/cesium-kit` token module. Web
chart/dynamic table channel colors come from one web token module, and the previously
drifting CCTV, radio, and launch assignments now match DESIGN.md and ADR 0024.

Eight existing Svelte files still contain component-scoped literal palettes. Replacing
them blindly risks visual regressions and would invent collaboration/voice channel
laws not present in DESIGN.md. Their exact value multisets are SHA-256 fingerprinted.
They are bounded follow-ups owned by the Web UI owner: migrate the core HUD literals
to semantic CSS custom properties before task 7.3 or the next visual edit to each
file, whichever comes first. `CollabBar.svelte` and `VoiceControlOrb.svelte` additionally
require accepted collaboration and voice-state palettes in DESIGN.md. New literals,
files, or count changes fail closed rather than falling under a broad ignore.

### Cesium dependency boundary

Both direct declarations remain for this task. All 16 product/test imports use the
public `cesium` surface and none import `@cesium/engine` directly. The lockfile resolves
`cesium` to 1.144.0 and its engine to 26.2.0; `vite-plugin-cesium-engine` and Cesium's
own package graph require the engine surface. Removing a declaration is authorized
only after a comparative clean install, bundle-budget measurement, rendered Playwright
smoke, and runtime verification show no regression. Task 5.0.6 makes no dependency
change based on package preference alone.

### Installed-versus-proposed documentation

Documentation now states that Redis, official OpenTelemetry packages, MapLibre,
Tailwind, React, `shadcn-svelte`, `bits-ui`, `paneforge`, `svelte-sonner`, and a PWA
plugin are absent. It distinguishes the installed `uPlot` and
`@tanstack/svelte-virtual` packages from actual imports, describes the static manifest
and service worker without claiming production PWA readiness, and marks satellites as
incomplete rather than production parity.

## Consequences

- Architectural debt is explicit, exact, and CI-enforced instead of rediscovered by grep.
- Safe clock and channel fixes land now with deterministic tests.
- Cohesive large-file and visual-token work remains bounded by named owners and gates.
- Dependency removal still requires measured evidence and a new ADR update.
