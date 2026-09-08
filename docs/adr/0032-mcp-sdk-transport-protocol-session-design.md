# ADR 0032: Incremental official MCP SDK adoption with preserved stdio compatibility

- **Status:** Accepted; HTTP implementation blocked on remaining OQ-1 integration facts
- **Date:** 2026-09-08
- **Task:** PLAN.md 6.1
- **Extends:** [ADR 0017](./0017-mcp-server-and-cli-architecture.md),
  [ADR 0020](./0020-server-proxies-and-cost-governor-architecture.md),
  [ADR 0027](./0027-shared-tool-registry-contracts-and-governed-actuators-architecture.md),
  [ADR 0040](./0040-architectural-drift-inventory-and-follow-up-gates.md)

## Context

GEV has a working hand-written MCP server over newline-delimited stdio, but no HTTP MCP
transport and no official MCP SDK dependency. Phase 6 needs a standards-compliant remote endpoint
without changing the local AI-Tadpole integration, duplicating the tool registry or governance
lifecycle, or adopting a protocol revision from memory.

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
| Current GEV ↔ current Tadpole local stdio | `2024-11-05` | `2024-11-05` | Preserve byte- and behavior-compatible hand-written GEV stdio through Phase 6. Tadpole revision `5afe7ed` now probes modern discovery before its legacy handshake; source inspection indicates compatibility, and 6.5 must freeze the refreshed transcript. |
| New GEV HTTP endpoint | `2026-07-28` | `2026-07-28` | Modern-only. Use `createMcpHandler(..., { legacy: 'reject' })`; reject unsupported versions with the specified supported-version error. Do not silently fall back. |
| Current Tadpole ↔ new GEV HTTP endpoint | `2026-07-28` candidate | `2026-07-28` candidate | Tadpole revision `5afe7ed` implements the matching modern request shape. Joint support is not yet proven because GEV has no endpoint and the client still needs fail-closed negotiation corrections plus cross-repository interop evidence. GEV will not serve legacy HTTP. |

GEV will not add the deprecated `2024-11-05` HTTP+SSE transport. GEV will not add the stateful
`2025-11-25` Streamable HTTP era merely to satisfy stale session/GET/replay wording. Supporting a
legacy HTTP era later requires explicit Tadpole evidence and an amendment to this ADR because it
reintroduces session ownership, GET/DELETE, resume tokens, and more cross-client isolation risk.

### Dependency and ownership boundary

After OQ-1 is resolved, task 6.2 may add only these exact runtime dependencies:

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
| Compatibility | Freeze the modern-probe-to-legacy-stdio transcript against Tadpole revision `5afe7ed`; run official inspector/conformance and cross-repository coverage against HTTP; prove direct/stdio/HTTP executor parity and exactly one audit pair. | 6.5 |
| Limits and shutdown | Bound body size, headers, concurrency, active response streams, tool duration, and notification queues. `handler.close()` must drain/abort on server shutdown. | 6.2, 6.5 |

## Migration and rollback

1. **6.1 (this ADR):** record the stable source evidence and preserve the existing runtime.
2. **OQ-1 gate:** treat Tadpole revision `5afe7ed` as the implementation candidate; obtain exact
   deployment origin/Host values, canonical MCP resource URI, authorization issuer/audience, and
   scope ownership, and assign the client negotiation/fallback corrections plus cross-repository
   test evidence. No `/mcp` implementation starts before this is accepted.
3. **6.2:** add the two exact dependencies, one isolated modern HTTP adapter, explicit feature
   kill-switch defaulting off, request/stream limits, Origin/Host guards, and protocol tests. Keep
   the stdio entry and CLI imports untouched.
4. **6.3:** add authenticated principal/capability context and route every call through the shared
   executor and existing scene confinement. Production remains fail-closed.
5. **6.4:** make schemas, annotations, result metadata, and capabilities truthful; notifications
   remain absent unless an isolated subscription implementation is proven.
6. **6.5:** run official inspector/conformance, malformed-input, cancellation, disconnect,
   concurrency, replay, auth, STASIS, path, and three-consumer parity tests before enabling the
   feature in any reviewed environment.

Rollback is bounded: disable the HTTP kill-switch, unmount `/mcp`, then remove the two direct SDK
dependencies and their lock entries. The hand-written stdio server, shared contracts, executor,
governance database, and scene data are unchanged, so rollback needs no data migration and does
not break the current Tadpole path.

## OQ-1 blocker and bounded choices

Task 6.2 remains `DOC_BLOCKER` until the developer provides or approves all of the following:

- deployment scheme, Host, exact Origin allowlist, and whether the endpoint is local-only or
  remotely reachable;
- canonical MCP resource URI, authorization issuer, token audience/resource, and scope mapping;
- ownership and evidence for correcting AI-Tadpole-OS revision `5afe7ed` so HTTP 401/403/5xx and
  governed denials fail closed, recognized modern negotiation errors do not trigger era fallback,
  unsupported intersections fail explicitly, and no `2024-11-05` initialize is sent to modern
  `/mcp`;
- the exact HTTP-to-stdio fallback trigger/configuration and cross-repository stdio/HTTP,
  cancellation, auth, negotiation, and failure-mode tests.

The developer selected the dual-transport direction: modern HTTP first, legacy stdio fallback.
The remaining bounded choices concern when that direction can be implemented:

1. Harden the implemented Tadpole modern client and supply the deployment and authorization values
   above; keep GEV HTTP modern-only and stdio as the fail-closed fallback.
2. Until those facts, corrections, and tests are ready, keep the proven `2024-11-05` stdio integration;
   Phase 6 remains blocked rather than exposing an unauthenticated endpoint.
3. If a real client instead requires legacy Streamable HTTP, provide its exact supported version and
   authorize an ADR amendment for dual-era serving. Do not add deprecated `2024-11-05` HTTP+SSE.

## Consequences

- GEV avoids reimplementing a security-sensitive modern protocol while retaining a known-good
  local integration and a simple rollback.
- The SDK adds a measurable server-only dependency cost and a second installed Zod major. That
  cost is accepted only at the isolated adapter boundary and must be remeasured after install.
- The stale Phase 6 assumptions about HTTP GET, protocol sessions, and event-ID reconnect are
  removed for the modern target rather than silently implemented as legacy behavior.
- Tadpole HTTP source now exists, but source inspection cannot manufacture deployment identity or
  joint conformance evidence. Phase 6 implementation is therefore honestly blocked on the
  remaining OQ-1 facts and client-interoperability evidence even though this decision task is
  complete.
