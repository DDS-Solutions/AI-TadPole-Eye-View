# ADR 0032: Incremental official MCP SDK adoption with preserved stdio compatibility

- **Status:** Accepted; OQ-1/Tadpole gate satisfied; Tasks 6.2–6.5 implemented and default-off
- **Date:** 2026-09-08
- **Task:** PLAN.md 6.1–6.5
- **Extends:** [ADR 0017](./0017-mcp-server-and-cli-architecture.md),
  [ADR 0020](./0020-server-proxies-and-cost-governor-architecture.md),
  [ADR 0027](./0027-shared-tool-registry-contracts-and-governed-actuators-architecture.md),
  [ADR 0040](./0040-architectural-drift-inventory-and-follow-up-gates.md)

## Context

At the task 6.1 decision point, GEV had a working hand-written MCP server over newline-delimited
stdio, but no HTTP MCP transport and no official MCP SDK dependency. Phase 6 needed a
standards-compliant remote endpoint without changing the local AI-Tadpole integration, duplicating
the tool registry or governance lifecycle, or adopting a protocol revision from memory.

The protocol changed materially after PLAN.md was written. The current stable revision,
`2026-07-28`, removes the initialization handshake, protocol sessions, the HTTP GET stream,
DELETE-based session termination, and event-ID resumability. It replaces them with per-request
metadata, optional `server/discover`, request-scoped response streams, and
`subscriptions/listen`. Implementing the older task text literally would therefore create a
legacy transport rather than the current stable target.

## Evidence inspected

### GEV repository at `c3ad7f8`

- `packages/ops-mcp/package.json` has no `@modelcontextprotocol/*` dependency. Its direct runtime
  dependencies are GEV workspace packages plus `zod`; the lock resolves that Zod line to
  `3.25.76`.
- `packages/ops-mcp/src/server.ts` is a hand-written newline JSON-RPC loop. It always answers
  `initialize` with `2024-11-05`, advertises only `tools: {}`, and implements `ping`,
  `tools/list`, and `tools/call`. It has no negotiated-version state, session isolation,
  cancellation handler, change-notification path, HTTP header validation, or remote auth.
- `packages/ops-mcp/src/tools.ts` exposes exactly seven local operator tools and confines scene
  I/O to root-level `.json` files under the configured scene root. It enforces a 1 MiB input cap,
  rejects absolute/traversal/separator/colon paths, rejects symlinks, and writes atomically.
- `packages/contracts/src/tools.ts` and its split registry/schema/projection modules remain the
  sole definitions for all thirteen operator/console tools. The MCP projection emits input and
  output JSON Schema plus GEV metadata.
- `packages/core/src/toolExecutor.ts` is the one execution lifecycle: contract and input
  validation, capability check, audit intent, budget/STASIS, reservation, approval, timeout,
  handler dispatch, output validation, and audit outcome. HTTP must call this executor; an SDK
  callback is not a second execution path.
- Existing tests prove local handshake/list/call behavior, stdout hygiene, shared-executor parity,
  exact audit pairing, STASIS visibility, signed approval, scene path confinement, atomic writes,
  and zero-fetch scene operations.

### Current AI-Tadpole-OS consumer

The initial task inspection used revision
[`f2c5447a4604ebaf9db46eecf3d62a8d75bb8217`](https://github.com/DDS-Solutions/AI-TadPole-OS/commit/f2c5447a4604ebaf9db46eecf3d62a8d75bb8217),
which contained only the hand-written `2024-11-05` stdio client. The developer then reported a
same-day update, so the authoritative repository was re-fetched and re-inspected at exact head
[`5afe7ed478972d4e27121556ef91d5d242986525`](https://github.com/DDS-Solutions/AI-TadPole-OS/commit/5afe7ed478972d4e27121556ef91d5d242986525).
That refresh supersedes the earlier statement that the HTTP client did not exist:

- [`client/mod.rs`](https://github.com/DDS-Solutions/AI-TadPole-OS/blob/5afe7ed478972d4e27121556ef91d5d242986525/server-rs/src/agent/mcp/client/mod.rs)
  now exposes one Rust facade with HTTP and stdio variants and constants for `2026-07-28` and
  `2024-11-05`.
- [`client/http.rs`](https://github.com/DDS-Solutions/AI-TadPole-OS/blob/5afe7ed478972d4e27121556ef91d5d242986525/server-rs/src/agent/mcp/client/http.rs)
  is a hand-written `reqwest` client that defaults to `2026-07-28`, sends the required Accept,
  content type, protocol, method/name, and namespaced `_meta` fields, and parses JSON or SSE
  responses.
- [`client/stdio.rs`](https://github.com/DDS-Solutions/AI-TadPole-OS/blob/5afe7ed478972d4e27121556ef91d5d242986525/server-rs/src/agent/mcp/client/stdio.rs)
  probes `server/discover` first and falls back to the `2024-11-05` initialize/initialized
  handshake when the probe fails. The existing GEV stdio server's method-not-found response to
  that probe is source-compatible with this fallback, subject to a new-revision golden interop
  test.
- The AI-Tadpole-OS client still has no official MCP SDK dependency. Source presence establishes
  a `2026-07-28` HTTP compatibility candidate, not proven joint runtime conformance.

The refresh also exposes integration gaps that must be closed before GEV enables remote MCP:

- HTTP discovery currently retries `tools/list` and then a `2024-11-05` `initialize` after every
  error class. It does not preserve HTTP 401/403 or 5xx as fail-closed outcomes, and
  `2024-11-05` HTTP+SSE is a different deprecated two-endpoint binding rather than a legacy
  handshake that can be sent to the modern `/mcp` endpoint.
- JSON-RPC errors are flattened before negotiation, so the declared `-32022`
  UnsupportedProtocolVersion code cannot yet drive supported-version selection. Discovery may
  also accept an arbitrary first server version instead of failing when there is no supported
  intersection.
- [`config.rs`](https://github.com/DDS-Solutions/AI-TadPole-OS/blob/5afe7ed478972d4e27121556ef91d5d242986525/server-rs/src/agent/mcp/config.rs)
  and the host select URL when present and command otherwise; they do not implement automatic
  HTTP-to-stdio failover. The remote client has static header injection but no demonstrated OAuth
  resource-server discovery, issuer/audience/scopes contract, endpoint allowlist, or end-to-end
  wire/fallback/cancellation coverage.

The developer-selected policy remains dual transport: prefer modern `2026-07-28` Streamable HTTP
and retain `2024-11-05` stdio as fallback. Fallback is permitted only for transport unavailability
or proven era incompatibility; HTTP 401/403/5xx, insufficient scope, STASIS, approval denial,
budget denial, or another governed rejection must fail closed and must never trigger a downgrade.

### 2026-09-09 client-fix re-audit

The developer-supplied working repository at `D:/TadpoleOS-Dev` was re-audited before accepting
the client gate. Its two configured non-shallow histories no longer resolve the previously
recorded `5afe7ed478972d4e27121556ef91d5d242986525` object, so ancestry from that historical
snapshot cannot be reproduced. After this discrepancy and the concrete client gaps were reported,
the developer explicitly directed completion of the Port 3000 contract. That authorization
permits a documented correction to the inspectable base; it does not permit silently substituting
one revision for another.

The corrected evidence chain is:

- developer-supplied implementation repository:
  `https://github.com/DDS-Solutions/TadPole-OS`;
- audited base: `f3b53231bd1928b737e65cdbd210907d534246b6`;
- published client-fix commit: `d9b29513f742f6f386ebddbe5174a26c7da8231c`;
- published structural decomposition: `1efba443ded024754c0b3b48a56b039eee085393`;
- published final verified implementation: `329d32d6d3940ff4564d94c1797f540065dbc6a0`;
- published evidence commit: `2dcde21f537cde6885950c5091078e83a2d1bd3c`;
- evidence artifact: `GEV_PORT_3000_EVIDENCE.md` in that repository's documentation directory.

The final implementation is a verified descendant of the audited base. Its exact conformance
suite passes 21/21, the focused HTTP surface passes 15/15, and the broader MCP surface passes
86/86; strict Clippy, Rust formatting, repository parity, AI-context, and graph blast-radius
checks pass. The client now implements the exact secret-free `prefer_http`
profile, modern-only discovery, bounded and correlated JSON/SSE handling, typed fallback causes,
strict catalog/header validation, stable retry operation identity, structured-result preservation,
and fail-closed behavior for every non-allowlisted failure. The cross-repository live smoke remains
Task 6.2/6.5 exit evidence because no GEV HTTP endpoint exists yet.

### Current official protocol and SDK

Primary sources were rechecked on 2026-09-08:

- The [2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/) is the current
  stable protocol. The [versioning specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
  defines modern, legacy, and dual-era behavior.
- The modern [Streamable HTTP binding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
  requires one POST endpoint, Origin validation, `Accept` support, per-request metadata and
  mirrored headers, header/body agreement, request-scoped JSON or SSE responses, and
  stream-close cancellation. It has no protocol session, GET stream, DELETE, or event-ID replay.
- The [stdio binding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)
  keeps one newline-delimited JSON-RPC message per line and requires stdout to contain only MCP
  messages. Modern stdio cancellation still uses `notifications/cancelled`.
- The [authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
  applies to HTTP, not stdio. Bearer authorization is required on every protected request;
  resource/audience, issuer, expiry, and scopes must be validated, query-string tokens and token
  passthrough are forbidden, and invalid/expired tokens fail with HTTP 401.
- The [tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
  requires valid input schemas, requires structured results to conform when an output schema is
  declared, treats annotations as untrusted hints, and delivers list changes only to opted-in
  `subscriptions/listen` streams.
- The official [TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk) is the
  stable SDK line implementing `2026-07-28`. Its
  [protocol-version guide](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions) serves both
  eras, and its [HTTP guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md)
  states that `createMcpHandler` does not itself validate Host, Origin, or tokens.

Read-only npm metadata reported these exact current packages:

| Package | Version | Boundary | Published unpacked size |
|---|---:|---|---:|
| `@modelcontextprotocol/server` | `2.0.0` | candidate direct dependency of `@gev/ops-mcp` | 6,299,914 bytes |
| `@modelcontextprotocol/core` | `2.0.0` | transitive only; never import directly unless later justified | 1,313,025 bytes |
| `zod` | `4.2.0` | transitive SDK dependency; not GEV domain-schema authority | 4,203,159 bytes |
| `@modelcontextprotocol/hono` | `2.0.0` | candidate direct dependency of `@gev/server` | 48,917 bytes |

The candidate published footprint is therefore about 11.32 MiB before package-manager overhead.
It is server-only and must add zero bytes to the browser bundle. The Hono adapter has no runtime
dependencies and peers on Hono `^4.11.4`; GEV currently resolves Hono `4.13.5`. The SDK requires
Node 20 or newer; GEV requires Node 24 or newer and was inspected under Node 26.2.0. No package was
installed and no manifest or lockfile changed in task 6.1.

## Options considered

| Option | Security and conformance | Maintenance/API stability | Cost and migration risk | Decision |
|---|---|---|---|---|
| Retain and harden hand-written code for HTTP | GEV would own parsing, era negotiation, header/body validation, response streaming, cancellation, and error mapping. Missing one rule could become an auth or cross-client flaw. | Zero SDK churn, but permanent protocol-spec maintenance. | Smallest dependency footprint; highest implementation and conformance risk. | Rejected for HTTP. Keep only as the proven local stdio compatibility leg. |
| Replace stdio and add HTTP with the SDK in one step | SDK owns protocol codecs, but a full cutover changes the exact wire behavior used by Tadpole. | One protocol stack after migration; v2 is stable but newly released and explicitly still settling. | Adds the full dependency footprint and couples local compatibility to remote rollout. | Rejected now. Reconsider only after golden transcript and conformance evidence. |
| Incrementally adopt SDK v2 for HTTP; retain current stdio | SDK owns modern HTTP parsing/version/error/stream behavior while GEV keeps auth, registry, governance, and path policy. | Pins stable public packages and isolates API churn behind one adapter. | Adds server-only footprint, duplicate Zod major, and an adapter, but rollback does not disturb stdio. | **Accepted.** |

## Decision

### Protocol envelope

| Surface | Floor | Ceiling | Policy |
|---|---:|---:|---|
| Current GEV ↔ current Tadpole local stdio | `2024-11-05` | `2024-11-05` | Preserve byte- and behavior-compatible hand-written GEV stdio through Phase 6. Task 6.5 freezes the exact modern discovery probe, preserved `-32601`, legacy initialization, and initialized notification from Tadpole implementation `329d32d6d3940ff4564d94c1797f540065dbc6a0`. |
| New GEV HTTP endpoint | `2026-07-28` | `2026-07-28` | Modern-only. Use `createMcpHandler(..., { legacy: 'reject' })`; reject unsupported versions with the specified supported-version error. Do not silently fall back. |
| Current Tadpole ↔ new GEV HTTP endpoint | `2026-07-28` | `2026-07-28` | Tadpole implementation `329d32d6d3940ff4564d94c1797f540065dbc6a0` and GEV Task 6.5 fixtures prove matching headers, namespaced metadata, client identity, stable operation identity, and fail-closed outcomes. The GEV loopback endpoint also passes the applicable current official Inspector and conformance scenarios. GEV does not serve legacy HTTP. |

GEV will not add the deprecated `2024-11-05` HTTP+SSE transport. GEV will not add the stateful
`2025-11-25` Streamable HTTP era merely to satisfy stale session/GET/replay wording. Supporting a
legacy HTTP era later requires explicit Tadpole evidence and an amendment to this ADR because it
reintroduces session ownership, GET/DELETE, resume tokens, and more cross-client isolation risk.

### Dependency and ownership boundary

Task 6.2 added only these exact external runtime dependencies:

- `@modelcontextprotocol/server@2.0.0` to `packages/ops-mcp/package.json`;
- `@modelcontextprotocol/hono@2.0.0` to `apps/server/package.json`.

`@modelcontextprotocol/core` and Zod 4 remain transitive. GEV's installed Zod 3 registry schemas
remain domain truth; task 6.2 must not migrate or duplicate them. If the adapter cannot consume
registry-produced JSON Schema and executor-validated input without importing a new schema source,
stop and amend this ADR before adding another dependency. No SDK package may enter `apps/web`,
`packages/contracts`, `packages/core`, `packages/governance`, providers, or the CLI.

The SDK is a protocol/transport adapter only. It does not own authorization, capability policy,
tenant identity, tool semantics, audit, approval, budget, STASIS, provider access, or filesystem
authority. `OPERATOR_TOOLS` and `GovernedToolExecutor` remain the only definition and execution
paths.

### Phase 6 obligation map

| Obligation | Current truth / invariant | Owner |
|---|---|---|
| Tool membership and ordering | Seven stdio tools come from `MCP_OPERATOR_TOOL_NAMES`; the full thirteen-tool registry remains authoritative. HTTP visibility is a deterministic capability-filtered projection, never an SDK-local list. | 6.3–6.4 |
| Input/output schemas | Reuse registry JSON Schema and executor Zod validation. Validate `structuredContent` before return and preserve serialized JSON text for compatibility. | 6.4 |
| Capabilities | Advertise only `tools`. Omit/false `listChanged` while the visible list is static. Do not claim prompts, resources, roots, sampling, logging, tasks, or subscriptions without implementation and tests. | 6.4–6.5 |
| HTTP transport and negotiation | One `/mcp` POST endpoint, modern `2026-07-28`, `server/discover`, per-request `_meta`, `MCP-Protocol-Version`, `Mcp-Method`, conditional `Mcp-Name`, header/body matching, correct JSON/SSE and error statuses. GET/DELETE return 405. No `/mcp/sse`. | 6.2, 6.5 |
| Lifecycle and session state | Modern HTTP has no initialize handshake or protocol session. Build a fresh cheap MCP server adapter per request around shared infrastructure; pass all caller state explicitly. Never key authority to a connection. | 6.2–6.3 |
| Cancellation | Closing an HTTP response stream aborts that request. Propagate an `AbortSignal` through the transport-independent execution boundary where safe; never emit a late response after cancellation. Preserve legacy stdio behavior until separately migrated. | 6.2, 6.5 |
| Notifications | Request-related messages stay on that request's stream. Long-lived list changes require an authenticated, capability-filtered `subscriptions/listen` implementation; until then advertise none and emit none. Never broadcast. | 6.4–6.5 |
| Authentication and authorization | The SDK handler is not an auth wall. Validate bearer tokens before body dispatch on every HTTP request; validate issuer, audience/resource, expiry, signature, and scopes; forbid query tokens and token passthrough. Stdio retains its local process/environment trust model. | 6.3, 6.5 |
| Host and Origin | Apply exact deployment allowlists before the SDK handler. Reject invalid present Origin with 403, protect localhost from DNS rebinding, and never treat CORS as authorization. | 6.2, 6.5 |
| Shared governance | Convert authenticated principal/scopes to one explicit executor capability set, then call the shared `GovernedToolExecutor` exactly once. Preserve audit intent/outcome, approval, reservation/settlement, STASIS, timeout, and replay rules. | 6.3, 6.5 |
| Filesystem authority | Keep scene identifiers as root-level bounded `.json` names under the configured root with canonical path, symlink, size, and atomic-write checks. Never accept remote absolute or caller-selected roots. | 6.3, 6.5 |
| Tool annotations and GEV metadata | Derive standard hints from explicit registry semantics; `dangerous` is not `destructive`. Put governance outcome detail in GEV `_meta`, not invented standard annotations. | 6.4, 6.5 |
| Compatibility | Freeze the modern-probe-to-legacy-stdio transcript against Tadpole implementation `329d32d6d3940ff4564d94c1797f540065dbc6a0`; run official inspector/conformance and cross-repository coverage against HTTP; prove direct/stdio/HTTP executor parity and exactly one audit pair. | 6.5 |
| Limits and shutdown | Bound body size, headers, concurrency, active response streams, tool duration, and notification queues. `handler.close()` must drain/abort on server shutdown. | 6.2, 6.5 |

## Migration and rollback

1. **6.1 (this ADR):** record the stable source evidence and preserve the existing runtime.
2. **OQ-1 gate (complete):** use the accepted local deployment, Host/Origin, resource, injected
   authority, scope, and ownership profile plus Tadpole client-fix
   implementation `329d32d6d3940ff4564d94c1797f540065dbc6a0` and evidence
   `2dcde21f537cde6885950c5091078e83a2d1bd3c`.
3. **6.2 (complete at `115586a`):** added the two exact dependencies, one isolated modern HTTP
   adapter, explicit feature kill-switch defaulting off, request/stream limits, Origin/Host guards,
   and protocol tests. The stdio implementation and its wire behavior remain unchanged.
4. **6.3 (complete at `7a46876`):** added immutable authenticated principal/capability context,
   per-request registry-derived visibility, shared-executor identity propagation, standard bearer
   challenges, and HTTP coverage of the existing scene confinement. Production remains
   fail-closed.
5. **6.4 (complete at `9d31ed4`):** schemas, annotations, result metadata, and capabilities are
   truthful; notifications remain absent. The authenticated request-local server declares
   `tools.listChanged: false` explicitly because the SDK registration helper otherwise defaults
   the flag to true.
6. **6.5 (complete):** exact-pinned official Inspector/conformance, immutable Tadpole source,
   malformed-input, cancellation, disconnect, concurrency, replay, auth, STASIS, path, and
   three-consumer parity tests pass. The HTTP feature remains default-off and local-only.

Rollback is bounded: disable the HTTP kill-switch, unmount `/mcp`, then remove the two direct SDK
dependencies and their lock entries. The hand-written stdio server, shared contracts, executor,
governance database, and scene data are unchanged, so rollback needs no data migration and does
not break the current Tadpole path.

## OQ-1 accepted Phase 6 profile and satisfied client-evidence gate

On 2026-09-08, the developer accepted the following local-first OQ-1 integration profile and
role-based ownership. This resolves the deployment, resource, authorization-shape, scope-mapping,
fallback-policy, and ownership decisions without inventing production identity or reachability.

### Deployment, Host, and Origin

- Phase 6 HTTP MCP is local-only. The server binds `127.0.0.1:3000`; the sole modern endpoint is
  `POST http://127.0.0.1:3000/mcp` and supports only `2026-07-28`.
- `GEV_MCP_HTTP_ENABLED` is the explicit kill switch and defaults to disabled. Remote reachability
  remains prohibited until tasks 6.3 and 6.5 supply authenticated, conformant evidence. Any later
  remote deployment requires HTTPS and an exact separately approved deployment hostname.
- The exact Host allowlist is `127.0.0.1:3000`. Missing or different Host values are rejected before
  body dispatch; forwarded Host headers are not trusted in this local profile.
- The Origin allowlist is empty. An absent Origin is permitted for the non-browser Tadpole client;
  every present Origin is rejected with 403. The web SPA is not authorized to call MCP directly.

### Resource, non-production authority, and scopes

- The canonical MCP resource URI and exact token audience/resource are
  `http://127.0.0.1:3000/mcp`.
- Task 6.2 uses only an injected deterministic non-production authority with issuer
  `https://auth.gev.test/` and subject `svc:tadpole-test`. Production issuer configuration remains
  unset and therefore fail-closed; `GEV_OPS_TOKEN` is not represented as issuer/audience-aware MCP
  authorization.
- OAuth scope strings map directly to the existing `CapabilityScope` vocabulary: `read.telemetry`
  permits `get_feed_health`, `get_budget`, `inspect_telemetry`, and `query_aoi`; `read.audit` permits
  `tail_logs`; `run_diagnostics` requires both; `write.scenes` permits `load_scene` and `save_scene`;
  `write.flags` permits `set_flag`; and `operate.cesium` permits `fly_to_location`, `toggle_layer`,
  `select_entity`, and `set_sim_time`. `agent.voice` grants no MCP operator tool. Scope possession
  never bypasses audit, approval, budget, reservation, STASIS, or path confinement.

### Explicit dual-transport fallback

- Tadpole must configure both transports explicitly: primary
  `http://127.0.0.1:3000/mcp`, fallback `pnpm --filter @gev/ops-mcp start`, and mode
  `prefer_http`. URL/command presence alone must not infer fallback.
- Fallback may be selected only during pre-tool discovery after a connection-refused or
  host-unreachable failure before any HTTP response, or after a recognized `-32022` discovery
  response proves no `2026-07-28` intersection. No tool may already have been dispatched.
- Fallback is forbidden after any HTTP response; authentication, authorization, scope, STASIS,
  approval, budget, rate, or other governed denial; TLS validation failure; malformed protocol
  data; cancellation; or ambiguous execution. Tadpole never sends a legacy `2024-11-05`
  `initialize` request to modern `/mcp`.

### Ownership and evidence

- The AI-Tadpole-OS Rust/MCP maintainer owns client corrections; the GEV Phase 6 implementer owns
  the HTTP adapter; and the joint DDS-Solutions integration owner owns cross-repository evidence.
  Evidence is pinned to immutable commit SHAs, not floating branches.
- Tadpole implementation `329d32d6d3940ff4564d94c1797f540065dbc6a0`, descending from corrected
  audited base `f3b53231bd1928b737e65cdbd210907d534246b6`, proves with mock-server tests
  that 401/403/5xx and governed denials do not fall back, `-32022` detail is preserved, only a
  supported intersection is selected, unsupported intersections fail, legacy initialization is
  never sent to `/mcp`, and both transports can be configured simultaneously. Evidence commit
  `2dcde21f537cde6885950c5091078e83a2d1bd3c` records exact commands and results.
- Actual Tadpole-to-GEV HTTP/stdio, cancellation, auth, negotiation, concurrency, and failure-mode
  evidence remains a Phase 6 conformance obligation once the GEV endpoint exists.

The developer conditionally authorized the embedded Task 6.2 four-pillar brief once this decision
and the required Tadpole client-fix evidence were recorded. Both conditions were satisfied, so
that authorization became effective on 2026-09-09. Task 6.2 implementation `115586a` now satisfies
its own exit gate. Task 6.3 implementation `7a46876` now supplies the scoped resource-server
boundary; the HTTP kill switch remains default-off and production remains fail-closed because no
production issuer is approved or configured.

## Task 6.2 implementation evidence

Implementation commit `115586a` adds a single isolated SDK-backed HTTP face without replacing the
existing stdio implementation:

- `@modelcontextprotocol/server@2.0.0` is direct only in `@gev/ops-mcp`, and
  `@modelcontextprotocol/hono@2.0.0` is direct only in `@gev/server`. The lock resolves
  `@modelcontextprotocol/core@2.0.0` and Zod `4.6.0` transitively; GEV's Zod `3.25.76` contracts
  remain authoritative. The adapter is exported only through the explicit `@gev/ops-mcp/http`
  subpath; no direct MCP SDK declaration/import enters the web, contracts, core, governance,
  provider, or CLI packages, and the root stdio/CLI entry does not load the HTTP adapter.
- Installed package files measure 6,299,914 bytes for server, 1,313,025 bytes for core, 48,917
  bytes for Hono, and 6,090,747 bytes for Zod 4.6.0: 13,752,603 bytes (13.12 MiB) total before pnpm
  store metadata. All four packages declare MIT. `pnpm audit --prod` reported no known
  vulnerabilities on 2026-09-09.
- The one exact `POST /mcp` route accepts only modern `2026-07-28`; `legacy: 'reject'` owns protocol
  era rejection. It validates empty-Origin policy, exact Host, bounded headers/body/concurrency,
  required mirrored headers and Accept values before SDK body dispatch; rejects legacy session and
  replay headers; isolates JSON/SSE responses; propagates stream cancellation; and aborts active
  work on idempotent shutdown. GET/DELETE return 405 with `Allow: POST`, and `/mcp/sse` is absent.
- `GEV_MCP_HTTP_ENABLED` defaults off. Only an injected non-production authority can reach the
  handler in task 6.2, and production deliberately ignores that authority and returns 503. The SDK
  callback registers the existing registry projection and invokes the shared governed executor;
  its verified call writes exactly one audit intent/outcome pair.
- Five fresh-process cold-start samples measured medians of 956.76 ms with the route disabled and
  974.56 ms enabled, a 17.80 ms observed route-construction impact on the benchmark host. The web
  build remains byte-identical to the recorded pre-6.2 baseline: the same entry and vendor hashes,
  105.78 KiB gzip app entry, and 1,247.15 KiB gzip total, so browser bundle delta is zero.
- The final focused server suite passes 126/126 and the MCP adapter suite passes 8/8 within the
  full 458-test unit gate. The final focused benchmark serves 100 MCP discovery/list requests at
  78.19 ms p95 under 300 ms with peak active work 10 under the configured cap of 16. The complete
  performance gate, strict typecheck, production build, lint, architecture, bundle, lockfile, and
  diff checks pass. Existing stdio coverage remains green at 14/14, including its golden wire
  behavior and stdout hygiene.

Task 6.2 did not claim the task 6.5 joint Tadpole-to-GEV live smoke or official inspector suite.
Those remain fail-closed obligations at their assigned gate.

## Task 6.3 implementation evidence

Implementation commit `7a46876` replaces the exact-token test authority with a scoped,
transport-independent resource-server boundary while preserving the default-off deployment:

- `@gev/contracts/mcp-authorization` defines the injected verifier request and the strict,
  bounded authorization context. It requires an AI service principal, tenant and task reference,
  exact matching audience/resource, recognized unique `CapabilityScope` values, and a valid
  issued/not-before/expiry window. The production composition ignores injected test verifiers and
  therefore remains fail-closed without inventing an issuer, JWKS, or introspection path.
- `OPERATOR_TOOL_REQUIRED_SCOPES` is the registry-owned policy. HTTP visibility is the canonical
  ordered intersection of authenticated scopes and `MCP_OPERATOR_TOOL_NAMES`; all required scopes
  must be present and `run_diagnostics` requires both `read.telemetry` and `read.audit`. The SDK
  owns no authorization policy and a fresh request-local server prevents cross-request mutation.
- Authentication completes before body parsing and SDK dispatch. Missing, malformed,
  query-string, invalid-signature, algorithm-confused, wrong-issuer, wrong-audience/resource,
  future, expired, unknown-scope, and overlong principal/tenant credentials return HTTP 401 with a
  Bearer challenge and write no audit entry. Authenticated insufficient scope returns HTTP 403
  with the missing scope and likewise never reaches the executor or audit trail.
- The immutable request context carries principal, tenant, task reference, AI actor, and stable
  operation ID through the one `GovernedToolExecutor` call. Concurrent distinct principals and
  tenants retain separate tool projections and execution identities. Successful calls keep the
  existing single audit intent/outcome and reservation/approval/settlement rules.
- All 16 existing scene-confinement cases now pass through HTTP in addition to direct/stdio
  coverage, preserving the configured root, root-level `.json` rule, 1 MiB cap, symlink denial,
  and atomic writes.
- Deterministic signed-token tests use the already-installed `jose` only from server test files.
  No dependency or lock entry changed; `pnpm install --frozen-lockfile --offline` passes. The MCP
  adapter suite passes 46/46, server passes 137/137, contracts 66/66, core 63/63, preserved stdio
  14/14, and the full unit gate passes 482 tests.
- Root lint checks 292 files; strict typecheck passes 17/17 tasks; all nine performance cases and
  the production build pass. One hundred authenticated discovery/list requests measured 83.52 ms
  p95 with peak active work 10 under cap 16. ADG, documentation tests, provider-registry drift,
  architecture drift, bundle budgets, dependency, diff, and synchronized-plan checks pass. The
  browser entry remains the exact pre-task `index-BuL6GLP-.js` hash at 105.78 KiB gzip and the
  total remains 1,247.15 KiB gzip, so browser bundle delta is zero.

Task 6.3 does not approve a production issuer, remote enablement, Phase 7 tenant persistence, task
6.4 protocol-truth work, or task 6.5 joint conformance.

## Task 6.4 implementation evidence

Implementation commit `9d31ed4` adds a server-only MCP presentation subpath without changing the
legacy stdio projection or adding a runtime dependency:

- `@gev/contracts/mcp-presentation` owns an exhaustive policy for all thirteen registry tools.
  `readOnlyHint` is derived from canonical mutation truth; destructive, idempotent, and open-world
  semantics are explicit. The policy deliberately records `set_flag` as dangerous but
  non-destructive and `save_scene` as destructive but not dangerous, proving that approval risk is
  not used as a destructive-behavior proxy. All current tools are explicit idempotent operations
  over GEV's bounded local domain rather than open-world calls.
- The modern HTTP adapter projects annotations only after intersecting authenticated request
  scopes with the seven implemented MCP handlers. Input and output JSON Schemas remain generated
  from the registry; SDK-local or hand-authored tool schemas were not introduced.
- Authenticated request-local servers declare only `tools` with `listChanged: false`. This corrects
  the official SDK helper's truthful-but-overbroad default of `true` for dynamically registered
  tools. Unauthenticated requests still register no tools capability, and no list-change or
  subscription notification path was added or invoked.
- Successful calls expose executor-validated `structuredContent`, equivalent serialized JSON text,
  and governed execution evidence only in result `_meta`. An invalid handler output becomes the
  existing `OUTPUT_VALIDATION_FAILED` error result and is never presented as successful structured
  content. The SDK's own output-schema check remains defense in depth after the shared executor.
- Table-driven contract coverage proves all thirteen policies. Focused MCP coverage proves exact
  schemas and annotations for the seven HTTP definitions, every implemented tool's successful
  structured result, invalid-output failure, static capabilities, absence of list notifications,
  preserved request scope isolation, and the unchanged 14-test stdio surface. Server route coverage
  proves the same capability, schemas, annotations, compatibility text, and governance metadata at
  the mounted endpoint.
- Final verification passes lint across 294 files, strict typecheck across 17/17 tasks, and the full
  499-test unit gate, including contracts 81/81, ops-mcp 48/48, server 137/137, and core 63/63. All
  nine performance cases pass; 100 authenticated MCP discovery/list requests measured 60.18 ms p95
  with peak active work 10 under cap 16. The production build, seed zero-network guards, ADG,
  documentation/provider-registry tests, architecture drift, bundle budgets, dependency inventory,
  diff, and synchronized-plan checks pass.
- No dependency or lock entry changed. The browser entry remains the exact
  `index-BuL6GLP-.js` hash at 105.78 KiB gzip and total bundle remains 1,247.15 KiB gzip, proving
  zero browser-bundle delta. The installed inventory remains 93 packages across 12 projects.

Task 6.4 does not approve production or remote MCP, notifications/subscriptions, task 6.5
conformance, Phase 7 identity/tenancy, provider work, UI work, or economic work.

## Task 6.5 conformance evidence

Task 6.5 adds test and harness evidence only; it does not change the HTTP adapter, shared executor,
tool catalog, authorization policy, governance policy, scene authority, or stdio product code:

- Root dev tooling pins `@modelcontextprotocol/inspector@2.5.0` and
  `@modelcontextprotocol/conformance@0.2.0-alpha.11`, both MIT. The conformance alpha is required
  because the older stable package line does not contain the current `2026-07-28` scenarios. npm
  metadata reports published unpacked sizes of 4,242,950 and 861,032 bytes respectively. They are
  test-only dependencies; runtime dependency declarations and the browser import graph are
  unchanged.
- `scripts/run-mcp-conformance.mjs` builds the server, starts a bounded seed-only GEV server on the
  accepted `127.0.0.1:3000/mcp` resource, and uses a loopback-only proxy solely to inject a
  deterministic test bearer and canonical Host that the official conformance CLI cannot supply.
  The Inspector uses an explicit `protocolEra: "modern"` session, discovers all seven authorized
  tools in strict mode, and reports zero schema errors. The official `tools-list` and
  `http-header-validation` scenarios pass at `2026-07-28`.
- This is deliberately not represented as a pass of the frozen everything-server requirements
  profile. That profile invokes diagnostic `test_*` tools and prompts, resources, sampling,
  logging, tasks, and subscriptions irrespective of GEV's advertised tools-only capability. GEV
  runs only the official scenarios applicable to its advertised surface rather than adding false
  capabilities or weakening expected failures. The loopback process, bounded captured output,
  temporary authorization config, and generated reports are cleaned on both success and failure.
- The HTTP matrix proves that an accepted operation ID returns the same settled result with one
  handler call, one audit pair, and no second charge. Approval denial replays without a second
  approval or dispatch; STASIS produces a durable `BUDGET_DENIED` before approval/dispatch; and an
  ambiguous post-dispatch failure becomes durable `IN_DOUBT` and can never redispatch. Existing
  route tests retain the 401/403, malformed/oversized, header/version, cancellation/shutdown,
  active-request, request-local authorization, stream isolation, path, and no-notification gates.
- The stdio interop test pins Tadpole version `1.1.462`, implementation commit
  `329d32d6d3940ff4564d94c1797f540065dbc6a0`, evidence commit
  `2dcde21f537cde6885950c5091078e83a2d1bd3c`, and the six relevant source blob IDs. Its literal
  newline transcript proves byte-exact modern `server/discover` → GEV `-32601` → legacy
  `2024-11-05` initialize behavior without changing GEV stdio bytes. Independently, a clean archive
  of that exact implementation commit passed its offline Port 3000 suite 21/21 with 787 unrelated
  tests filtered out; no floating branch or dirty working tree supplied evidence.

Task 6.5 does not enable production or remote MCP, add legacy HTTP, approve subscriptions or
notifications, complete the Phase 6 exit gate, or authorize any Phase 7 work.

## Consequences

- GEV avoids reimplementing a security-sensitive modern protocol while retaining a known-good
  local integration and a simple rollback.
- The SDK adds a measurable server-only dependency cost and a second installed Zod major. That
  cost is accepted only at the isolated adapter boundary and must be remeasured after install.
- The stale Phase 6 assumptions about HTTP GET, protocol sessions, and event-ID reconnect are
  removed for the modern target rather than silently implemented as legacy behavior.
- Tadpole client-fix and deterministic evidence now exist as published immutable commits. Task 6.5
  freezes the joint request/response contract and official loopback evidence while scoped server
  authorization remains default-off. The separate Phase 6 exit gate remains pending explicit
  authorization.
