# DESIGN.md — UI, HUD & Visual Design System

**Audience:** Frontend engineers and AI agents implementing UI components, HUD overlays, telemetry visualizers, and themes in GEV v2 (`apps/web`, `packages/cesium-kit`).
**Source of truth:** [PLAN.md](../PLAN.md) §3.3.

---

## 1. Design Philosophy: Industrial OSINT & Tactical Command Console

GEV v2 is a high-density, real-time geospatial intelligence console. The visual language balances maximum information density with minimal cognitive friction:

- **Globe as Primary Surface**: The 3D globe (CesiumJS) is the primary viewport. UI components float as glassmorphic HUD overlays above the canvas.
- **Strict Pointer Pass-Through**: Container overlays must specify `pointer-events: none`, while interactive cards, toolbars, and inputs specify `pointer-events: auto`.
- **Zero Layout Shift / Monospace Precision**: Dynamic telemetry values, coordinates, timestamps, and squawk codes must use fixed-width monospace typography (the current semantic `.mono` class, `JetBrains Mono`, or `ui-monospace`). Tailwind utility names are not an installed styling surface.
- **Decoupled 60 FPS Rendering**: UI state is reactive via Svelte 5 runes (`$state`, `$derived`). Per-frame Cesium rendering passes through the imperative rAF queue in `packages/cesium-kit`, preventing HUD rerenders from degrading globe performance.

---

## 2. Color System & Design Tokens

### 2.1 Core Neutral Palette

| Token | Class / Value | Hex | Description |
|---|---|---|---|
| **Base Surface** | `bg-surface-void` | `#030712` | Deep obsidian background behind the WebGL canvas |
| **Glass Panel** | `bg-panel-glass` | `rgba(15, 23, 42, 0.85)` | Blur card background (`backdrop-filter: blur(12px)`) |
| **Glass Border** | `border-panel` | `rgba(148, 163, 184, 0.18)` | Subtle translucent slate border |
| **Text Primary** | `text-primary` | `#f8fafc` (Slate 50) | High-contrast titles, metrics, coordinates |
| **Text Muted** | `text-muted` | `#94a3b8` (Slate 400) | Secondary labels, units, and timestamps |
| **Accent Glow** | `glow-cyan` | `0 0 12px rgba(56, 189, 248, 0.35)` | Focus and active selection ring |

### 2.2 Telemetry Channel Color Laws

Every telemetry domain is strictly mapped to a dedicated color channel across globe billboards, 2D icons, HUD badges, and list items. **AI agents must never alter these channel assignments:**

| Channel | Hex Token | Accent Name | Description |
|---|---|---|---|
| **Aviation (ADS-B)** | `#38bdf8` | `Sky Cyan` | Aircraft vectors, altitude tracks, callsigns |
| **Maritime (AIS)** | `#2dd4bf` | `Emerald Teal` | Vessels, cargo, tankers, course-over-ground |
| **Seismic (USGS)** | `#fb923c` | `Amber Orange` | Earthquakes, magnitude rings, hypocentral depth |
| **Thermal (FIRMS)** | `#f43f5e` | `Rose Red` | NASA thermal hotspots, wildfire FRP points |
| **Urban Mobility (GBFS)** | `#818cf8` | `Indigo Violet` | Bikeshare docks, capacity gauges |
| **Submarine Infrastructure** | `#f472b6` | `Magenta Pink` | Cable routes and landing points |
| **Governance / STASIS** | `#eab308` / `#ef4444` | `Gold / Red` | Budget burn meter, approval prompts, STASIS lockdown |

---

## 3. Typography Hierarchy

- **UI Headings**: Sans-serif (`Inter`, `system-ui`, `-apple-system`), semi-bold (600), tracking tight (`tracking-tight`).
- **Telemetry Values**: Monospace (`JetBrains Mono`, `ui-monospace`, `monospace`), tabular numbers (`tabular-nums`), font-medium (500).
- **Attributions & Legal**: Sans-serif 11px (`text-xs`), muted (`text-slate-400`).

---

## 4. Installed and proposed component architecture ([PLAN.md §3.3](../PLAN.md))

Package manifests are the installed source of truth:

1. **Primitives**: Current controls are native Svelte components with component-scoped CSS. `shadcn-svelte` and `bits-ui` are not installed; adopting either requires the normal dependency and accessibility review.
2. **Docking Panes**: `paneforge` is not installed. The current HUD uses fixed overlays; resizable panes remain proposed work.
3. **High-Density Lists**: `@tanstack/svelte-virtual` is installed, but the current `VirtualizedTelemetryTable.svelte` uses its own bounded window calculation and does not import that package. Do not attribute the implementation to TanStack until a measured migration lands.
4. **Time-Series Charts**: `uPlot` is installed and used by `TelemetryTimelineChart.svelte` for Canvas rendering.
5. **Toasts & Alerts**: `svelte-sonner` is not installed. Current alerts are local component state; a toast dependency requires review before adoption.

---

## 5. Planned operator interaction model

This section is an approved design contract for future PLAN.md tasks, not a claim that the
current UI implements these behaviors.

### 5.1 Progressive disclosure and pinned detail

- Layer, event, and health summaries begin as compact overview rows/cards. Opening one reveals
  a bounded detail surface rather than permanently enlarging the HUD.
- Transient detail may auto-close only when no form, approval, credential validation, or other
  consequential interaction is active. Show the countdown and reset it only for intentional
  pointer, keyboard, or assistive-technology interaction inside the surface.
- Pinning suppresses auto-close and continues bounded data refresh. Pin state is explicit,
  keyboard accessible, and serialized only if the governing Scene contract includes it.
- Empty states explain the cause: `NO EVENTS IN AOI`, `SETUP REQUIRED`, `APPROVAL REQUIRED`,
  `PLANNED`, `SOURCE UNAVAILABLE`, or `STALE LAST-KNOWN DATA`. Never render a blank panel or
  convert absence into a zero.

### 5.2 AOI scopes and temporal layers

- Compatible alerts, radar, lightning, fire, camera, and risk layers may expose an AOI-centered
  scope with selectable bounded radius, range rings, distance/bearing inspection, and discrete
  nudge controls. The selected geometry remains a validated Scene/AOI value, not component-local
  Cesium state.
- Time-enabled imagery shows source observation time, validity window, playback position, and
  newest available frame. Playback never changes global SimClock unless the user explicitly
  chooses a synchronized mode.
- A deterministic solar terminator/day-night layer follows SimClock and uses no external
  provider. It must preserve label/telemetry contrast and never obscure alert geometry.

### 5.3 Named scenes and wallboard mode

- Named views reuse the versioned Scene contract for camera, layers, selections, AOI, and
  SimClock offset. Do not introduce an independent dashboard-layout state format.
- A wallboard playlist rotates only selected scenes, shows current/next scene and time remaining,
  pauses immediately on user interaction or a priority alert, and resumes after a visible,
  configurable idle countdown.
- A priority alert may temporarily focus its AOI, but acknowledgement/expiry restores the exact
  prior scene. Automatic focus and restoration are auditable and never erase user changes made
  while paused.

### 5.4 Alert and evidence behavior

- Alert presentation is driven by validated urgency, severity, certainty, effective time,
  expiry/cancellation, AOI, and source identity. Higher-priority information may preempt a lower
  item; the preempted item resumes only if it remains valid.
- Repeated observations deduplicate by a stable source/event identity. Notifications repeat only
  for an approved threshold escalation or after an explicit cooldown policy; acknowledgement is
  actor- and tenant-scoped.
- Audio mute, browser notification permission, and external delivery authorization are separate
  controls. Muting one never acknowledges, suppresses, or authorizes another.
- Derived estimates visibly surface contradictory observations with links to both evidence paths.
  “Prediction differs from observation” is a supported state, not an error banner or a reason to
  overwrite either value.

---

## 6. Planned Settings → Layer Access panel

Every provider/feed/layer accepted into the typed registry appears in one searchable Settings
panel, grouped by domain and sorted consistently. Implemented, planned, incomplete, unavailable,
and locked entries remain discoverable. The panel and layer picker consume the same registry
projection; neither maintains a provider-name switch statement or duplicated list.

### 6.1 Layer picker behavior

- An available layer uses the normal toggle and its domain color.
- A locked layer toggle is visibly muted/gray and cannot activate. Its persistent status text
  names the blocker, for example `API KEY REQUIRED`, `TERMS APPROVAL REQUIRED`, `SOURCE SETUP
  REQUIRED`, `PLANNED`, `DISABLED BY POLICY`, or `UNAVAILABLE`.
- Because a native disabled control cannot reliably receive focus or expose a tooltip, place an
  active, keyboard-accessible **Set up** or **Review requirement** control beside it. That control
  opens the exact Layer Access entry and returns focus to the layer row on close.
- A locked layer never disappears when filters such as “active only” are off. An optional
  “available only” filter must announce how many discoverable entries it is hiding.
- Lock gray is neutral UI chrome, not a telemetry-domain color. Pending human approval uses the
  governance gold semantic; invalid/rejected/revoked states use governance red. Never invent a
  provider brand color as a status channel.

### 6.2 Required entry content

Each entry presents registry-derived, non-secret fields:

- provider, feed, and layer names plus implementation and effective-access state;
- source organization, exact product, geographic coverage, update expectation, source mode,
  delivery mode, observation age, retrieval/cache age, last success/error, and next expected poll;
- credential type and scopes, masked fingerprint, validation time/status, rotation/revocation
  actions, and the authoritative **Get API key / Create account** link when applicable;
- license/terms identifier, authoritative terms link, reviewed version or digest, attribution,
  approved use/environment/redistribution scope, approver, review/expiry date, and revocation;
- configuration requirements, cost/quota tier, cache/rate/budget policy, kill-switch owner, and
  health details; and
- concise numbered setup instructions generated from versioned registry metadata, with a link to
  the longer source-specific document. Instructions never contain real credentials.

### 6.3 Unlock flow

1. **Review requirements:** show credentials, terms, configuration, cost/quota, attribution, and
   supported-environment gates separately before accepting input.
2. **Open the authoritative provider page:** account creation, API-key issuance, and provider-side
   terms acceptance occur only on the allowlisted primary-source URL. GEV does not automate them.
3. **Submit credentials securely:** accept only the declared credential shape over an authenticated
   server route. Password managers and paste are allowed; browser/local storage and client logs are
   not. Replace the value immediately with a masked fingerprint and never return it from the server.
4. **Validate narrowly:** prefer a provider status/quota endpoint. Otherwise use one bounded,
   budgeted, cached request after audit intent and record audit outcome without response secrets.
5. **Record approval:** a permitted human reviews the exact terms/version and records allowed use,
   environments, attribution, redistribution, review/expiry, and tenant. A key is not approval.
   Individual click-through cannot stand in for required organizational, commercial, or legal signoff.
6. **Enable:** the toggle activates only after implementation, credential, terms, configuration,
   policy, and runtime gates all pass. The UI announces success and the effective access reason.
7. **Relock safely:** invalid/expired/revoked credentials, rejected/expired/superseded terms,
   missing configuration, kill-switch disablement, insufficient budget/capability, or STASIS disables
   new live activation immediately. Lawful seed or cached data may remain visible only with explicit
   mode and staleness labels.

### 6.4 Credential and approval errors

- Never report “invalid key” for a provider outage, timeout, quota exhaustion, unsupported scope,
  or terms failure. Preserve those as distinct states with a retry policy and support link.
- A validation success message confirms only the tested credential/scope. It must not imply that
  billing, licensing, redistribution, all endpoints, or production use were approved.
- Credential replacement and deletion require explicit confirmation, audit intent/outcome, and a
  post-action state refresh. Deletion is idempotent and must not reveal whether another tenant has
  configured the same provider.

---

## 7. Feed health and semantic freshness

- Health is based on valid source observation/validity time, schema/contract validation, and
  delivery behavior—not HTTP status alone. A fresh `200 OK` response containing stale source data
  is degraded/stale.
- Observation time, retrieval time, cache origin time, and next expected update are visually
  distinct and use monospace/tabular formatting. Avoid the ambiguous label “updated” by itself.
- Keep last-known-good data only within registered retention policy. Display its age and degraded
  reason on both the globe and detail panel; never silently keep drawing it as live.
- Manual refresh is available only when the source policy permits it and must still pass auth,
  rate, cache, budget, capability, kill-switch, and STASIS gates. Disable refresh while a validated
  request is in flight and expose its result without optimistic success.

---

## 8. Review Anti-Patterns (Instant PR Rejection)

- Adding arbitrary or clashy colors outside the telemetry channel map.
- Placing opaque solid backgrounds over the globe where glassmorphism is specified.
- Mutating Cesium camera or primitives directly from Svelte component script tags instead of `packages/cesium-kit`.
- Omitting required OpenStreetMap attribution (`footer.attribution-badge`).
- Hiding planned or locked registry entries, or enabling a layer merely because an API key exists.
- Treating a terms checkbox as organizational/legal approval without versioned evidence and authority.
- Persisting provider secrets in browser storage, echoing them after submission, logging them, or
  rendering more than a non-reversible masked fingerprint.
- Calling a provider directly from the browser to avoid the Layer Access, pinned-fetch, audit,
  budget, cache, rate, capability, kill-switch, or STASIS path.
- Reporting a successful save/validation before the server confirms durable state and returns the
  new registry-derived access status.
