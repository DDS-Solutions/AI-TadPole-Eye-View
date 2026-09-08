# AI-Tadpole-OS to GEV Port 3000 Client Contract

**Status:** Required client contract for the Task 6.2 documentation and interoperability gate  
**Audience:** AI-Tadpole-OS Rust/MCP maintainers and the joint DDS-Solutions integration owner  
**Decision source:** [ADR 0032](../adr/0032-mcp-sdk-transport-protocol-session-design.md) and
[PLAN.md](../../PLAN.md) §9.3 and Task 6.2  
**Protocol:** MCP `2026-07-28`, modern stateless Streamable HTTP only

This document defines what AI-Tadpole-OS must send to, accept from, and enforce around the GEV MCP
endpoint on local port 3000. It is a client implementation contract, not evidence that the GEV
endpoint already exists or is enabled. Task 6.2 remains blocked until the immutable Tadpole
client-fix evidence in [Evidence required to open Task 6.2](#evidence-required-to-open-task-62)
is supplied.

Normative words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** apply to the AI-Tadpole-OS client.
Where this deployment profile is stricter than the general MCP compatibility rules, this profile
wins for the GEV connection.

## What 100% alignment means

AI-Tadpole-OS is aligned when it:

1. explicitly configures GEV HTTP as the primary transport and GEV stdio as a separate fallback;
2. sends self-contained `2026-07-28` JSON-RPC requests to the exact `/mcp` endpoint;
3. mirrors request fields into the required HTTP headers and sends the standard `_meta` envelope
   on every request;
4. supports both JSON and request-scoped SSE responses, including stream-close cancellation;
5. preserves structured JSON-RPC errors and applies the fail-closed fallback matrix below;
6. injects an audience-bound bearer token when authorization is enabled and never leaks it;
7. derives available tools and schemas from `tools/list` instead of hardcoding them; and
8. supplies immutable mock-server test evidence covering every gate in this document.

Ports 5173 and 8000 do not replace this endpoint. Port 5173 is the AI-Tadpole-OS browser surface,
port 8000 is its local backend, and port 3000 is the future GEV MCP listener. AI-Tadpole-OS must
make an outbound client connection to port 3000; GEV will not discover or poll ports 5173/8000.

## Fixed local connection profile

| Setting | Required value or behavior |
|---|---|
| Primary URL | `http://127.0.0.1:3000/mcp` |
| Canonical resource URI | `http://127.0.0.1:3000/mcp` |
| Transport mode | Explicit `prefer_http`; never inferred from URL/command presence |
| HTTP protocol allowlist | Exactly `2026-07-28` |
| HTTP method | `POST` only |
| Host authority | Exactly `127.0.0.1:3000`, normally derived from the URL |
| Origin | Omit it. The GEV Origin allowlist is empty; every present Origin is rejected with 403. |
| HTTP state | Stateless; one POST and one response per JSON-RPC message |
| GEV kill switch | `GEV_MCP_HTTP_ENABLED`, default off and owned by GEV |
| Maximum request body | 1 MiB including the complete JSON-RPC envelope |
| Browser access | Prohibited; the 5173 UI must not call `/mcp` directly |
| Production/remote access | Prohibited in Task 6.2; a later remote profile requires HTTPS and a new decision |
| Test issuer | `https://auth.gev.test/` |
| Test subject | `svc:tadpole-test` |
| Test token audience/resource | Exact canonical resource URI above |
| Stdio fallback command | `pnpm --filter @gev/ops-mcp start`, launched from the GEV repository root |

## Required configuration shape

The Rust field names may differ, but the configuration must express these values independently:

```toml
[mcp.gev]
mode = "prefer_http"

[mcp.gev.http]
url = "http://127.0.0.1:3000/mcp"
protocol_versions = ["2026-07-28"]
resource = "http://127.0.0.1:3000/mcp"
bearer_token_source = "injected"

[mcp.gev.stdio_fallback]
command = "pnpm"
args = ["--filter", "@gev/ops-mcp", "start"]
cwd = "<GEV_REPOSITORY_ROOT>"
```

The HTTP URL and stdio command MUST coexist in one configuration. `mode = "prefer_http"` MUST be
an explicit enum/state, not a side effect of whichever field was parsed last. The client must not
copy the example placeholder path literally.

Recommended configurable timeouts are 5 seconds for the pre-tool discovery attempt and 30 seconds
for an individual tool request. A discovery timeout is deliberately **not** an approved fallback
trigger; it fails closed. Tool-specific server limits remain authoritative if advertised.

## Connection and negotiation state machine

The client must implement these states or equivalent behavior:

```text
configured
    |
    v
HTTP_DISCOVERING -- valid 2026-07-28 discovery --> HTTP_READY
    |                                                    |
    | approved pre-tool fallback cause                   | first tool dispatch
    v                                                    v
STDIO_DISCOVERING --> legacy stdio negotiation       HTTP_COMMITTED
    |                                                    |
    v                                                    v
STDIO_READY                                           no transport fallback

Any non-approved failure --------------------------------> FAILED_CLOSED
```

Required behavior:

1. Validate the fixed profile before opening either transport.
2. Send `server/discover` over HTTP before any `tools/list` or `tools/call` request.
3. Accept HTTP mode only if `result.supportedVersions` contains exactly supported client version
   `2026-07-28`. Do not select the first advertised value blindly.
4. Treat `serverInfo` as untrusted display/diagnostic data. Never use it for authorization,
   version selection, or security decisions.
5. Cache the selected transport only for the lifetime of that configured GEV client instance.
6. Once any tool request has been dispatched, never change transports for that logical call and
   never resubmit it through stdio.
7. A later reconnect starts a new pre-tool discovery phase; it does not make an ambiguous prior
   tool safe to replay.

## HTTP request contract

Every request is its own `POST /mcp` with one JSON-RPC request body. Batch arrays, JSON-RPC response
bodies sent by the client, a persistent GET stream, and client HTTP cancellation notifications are
not part of this profile.

### Required headers

| Header | Value/rule |
|---|---|
| `Host` | `127.0.0.1:3000`; do not override the URL-derived authority |
| `Content-Type` | `application/json` |
| `Accept` | Must list both `application/json` and `text/event-stream` |
| `MCP-Protocol-Version` | `2026-07-28` on every POST |
| `Mcp-Method` | Exact case-sensitive value of body `method` |
| `Mcp-Name` | Exact body `params.name` for `tools/call`; omit for `server/discover` and `tools/list` |
| `Mcp-Param-{Name}` | Conditionally derived from valid `x-mcp-header` tool schema annotations |
| `Authorization` | `Bearer <token>` on every protected request; never place the token in the URL |

Header names are case-insensitive; header values used for matching are case-sensitive. The client
MUST omit `Origin`, `Mcp-Session-Id`, and `Last-Event-ID`. It MUST NOT send GET or DELETE to `/mcp`,
and it MUST NOT probe `/mcp/sse`.

### Standard metadata on every request

`params._meta` must contain the protocol version, stable client build identity, and truthful client
capabilities. Empty capabilities are valid and preferred until AI-Tadpole implements a capability
needed by GEV.

```json
{
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": {
    "name": "ai-tadpole-os",
    "version": "<immutable-build-version>"
  },
  "io.modelcontextprotocol/clientCapabilities": {}
}
```

The protocol version in `_meta` and `MCP-Protocol-Version` MUST agree byte-for-byte.

### Discovery request

```http
POST /mcp HTTP/1.1
Host: 127.0.0.1:3000
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: server/discover
Authorization: Bearer <injected-test-token>
```

```json
{
  "jsonrpc": "2.0",
  "id": "discover-1",
  "method": "server/discover",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "ai-tadpole-os",
        "version": "<immutable-build-version>"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

A valid result has `resultType: "complete"`, a `supportedVersions` array containing
`2026-07-28`, truthful capabilities, and optional `_meta.io.modelcontextprotocol/serverInfo`.
GEV will advertise only implemented capabilities; AI-Tadpole must not assume prompts, resources,
roots, sampling, logging, tasks, or subscriptions.

### Tool-list request

```json
{
  "jsonrpc": "2.0",
  "id": "tools-list-1",
  "method": "tools/list",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "ai-tadpole-os",
        "version": "<immutable-build-version>"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

Send `Mcp-Method: tools/list` and no `Mcp-Name`. The returned list is ordered and
capability-filtered. AI-Tadpole MUST treat it as the active catalog and validate each input schema.
Do not hardcode a tool count or assume that the stdio and HTTP projections are identical.

### Tool-call request

```http
POST /mcp HTTP/1.1
Host: 127.0.0.1:3000
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: get_budget
Authorization: Bearer <injected-test-token>
```

```json
{
  "jsonrpc": "2.0",
  "id": "tool-call-1",
  "method": "tools/call",
  "params": {
    "name": "get_budget",
    "arguments": {},
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "ai-tadpole-os",
        "version": "<immutable-build-version>"
      },
      "io.modelcontextprotocol/clientCapabilities": {},
      "operation_id": "00000000-0000-4000-8000-000000000001"
    }
  }
}
```

AI-Tadpole SHOULD generate a UUID `operation_id` for every logical tool call and MUST do so for any
call that could be retried. The JSON-RPC `id` identifies one transport request; `operation_id`
identifies the governed logical operation. Never reuse an operation ID with different tool names
or arguments. Never automatically retry an ambiguous, cancelled, or timed-out tool execution.
Only retry when GEV explicitly marks the outcome retryable, and retain the same `operation_id`.

### `x-mcp-header` support

The current registry may not emit custom mirrored parameters, but a conforming HTTP client must
support them:

- inspect each `tools/list` input schema for statically reachable primitive properties annotated
  with `x-mcp-header`;
- exclude a tool whose annotation is invalid, duplicated case-insensitively, unsafe, applied to a
  non-primitive/number, or reachable only through arrays, composition, conditionals, or `$ref`;
- when an annotated argument is present and non-null, emit `Mcp-Param-{annotation}` with the exact
  primitive value; otherwise omit the header;
- encode non-ASCII, control-containing, leading/trailing-whitespace, or sentinel-looking values as
  `=?base64?BASE64_UTF8?=`; apply the same encoding to an unsafe `Mcp-Name`; and
- on `-32020` caused by a missing custom header, refresh `tools/list` before any safe retry.

## Response handling

AI-Tadpole MUST inspect both the HTTP status and the response body.

### JSON response

For `Content-Type: application/json`, parse one JSON-RPC response, correlate its `id`, retain the
full `error.code`, `error.message`, and structured `error.data`, and validate the result shape.
Do not flatten errors to strings. On a successful tool result:

- consume validated `structuredContent` when present;
- retain `content` as the human-readable compatibility representation;
- treat `isError: true` as a completed tool-level failure, not as a transport failure; and
- retain GEV `_meta.execution` fields for audit/replay diagnostics without exposing secrets.

### Request-scoped SSE response

For `Content-Type: text/event-stream`, the client MUST:

1. parse SSE framing incrementally and ignore comment/keep-alive lines;
2. accept only notifications related to that originating request before its final response;
3. reject an independent server-to-client JSON-RPC request on the stream;
4. correlate and validate the final JSON-RPC response, then close the stream;
5. prevent every event from being delivered to another request or tenant context;
6. never reconnect with `Last-Event-ID` and never create a standalone GET stream; and
7. cancel by closing/aborting that response stream, without sending `notifications/cancelled`.

After local cancellation, discard late bytes and never treat the lack of a final response as proof
that a mutation did not execute.

## Authorization and scopes

Task 6.2 uses only an injected deterministic test authority. AI-Tadpole MUST accept the bearer
token from an injected secret provider/test harness; it must not mint, self-sign, print, persist in
logs, forward to a provider/tool, or put the token in a query string. Permanent token acquisition,
production identity, tenant claims, and remote access belong to Task 6.3 and later decisions.

The test token must be valid for:

- issuer `https://auth.gev.test/`;
- subject `svc:tadpole-test`;
- exact audience/resource `http://127.0.0.1:3000/mcp`;
- current issuance/expiry window; and
- the scopes required by the requested tool.

| Scope | Potentially visible tools |
|---|---|
| `read.telemetry` | `get_feed_health`, `get_budget`, `inspect_telemetry`, `query_aoi` |
| `read.audit` | `tail_logs` |
| Both `read.telemetry` and `read.audit` | `run_diagnostics` |
| `write.scenes` | `load_scene`, `save_scene` |
| `write.flags` | `set_flag` |
| `operate.cesium` | `fly_to_location`, `toggle_layer`, `select_entity`, `set_sim_time` |
| `agent.voice` | No MCP operator tool |

A scope controls visibility/eligibility only. It never bypasses audit, approval, budget,
reservation, STASIS, timeout, idempotency, or scene-path confinement.

## Fail-closed error and fallback matrix

This table is the complete fallback policy. A generic MCP library's automatic HTTP-era downgrade
MUST be disabled or wrapped so it cannot broaden these rules.

| Observation during HTTP discovery | Client action | Stdio fallback? |
|---|---|---:|
| TCP connection refused before any HTTP response | Close HTTP attempt; start configured stdio transport | Yes |
| Host unreachable before any HTTP response | Close HTTP attempt; start configured stdio transport | Yes |
| Structured `-32022` and `data.supported` has no `2026-07-28` intersection | Preserve error; close HTTP; start configured stdio | Yes |
| Structured `-32022` advertises `2026-07-28` after client requested another allowed version | Retry discovery once with exact `2026-07-28` | No |
| Structured `-32022` rejects an already exact `2026-07-28` request while advertising it | Report protocol inconsistency | No |
| 400 / `-32020` header mismatch or other recognized modern error | Correct the client defect or surface it | No |
| 401 invalid/missing/expired token | Surface authorization failure | No |
| 403 Origin, scope, policy, or governed denial | Surface denial | No |
| 404 / `-32601`, 405, 409, 429, or any 5xx response | Preserve status/error and fail closed | No |
| Empty, malformed, wrong-ID, wrong-content-type, or otherwise invalid response | Report protocol failure | No |
| DNS/TCP timeout, reset, TLS validation failure, or cancellation | Report transport failure/ambiguity | No |
| Failure after `tools/list` or any `tools/call` was dispatched | Preserve state; never change transport for that call | No |
| Tool result with `isError: true`, STASIS, approval/budget denial, or retryable metadata | Treat as governed tool outcome | No |

The `-32022` exception switches to a separately configured stdio process; it does not send legacy
HTTP traffic. AI-Tadpole MUST never send `initialize`, open GET, send DELETE, or probe the deprecated
HTTP+SSE transport against `http://127.0.0.1:3000/mcp`.

## Stdio fallback contract

Only an approved pre-tool discovery cause may launch the configured command. Once launched:

1. use the GEV repository root as `cwd` and require the ops-mcp package to be built;
2. keep stdout exclusively for newline-delimited JSON-RPC and treat stderr as diagnostics;
3. probe `server/discover` first;
4. if the preserved GEV stdio server returns non-modern method-not-found, negotiate its legacy
   `2024-11-05` `initialize`/`notifications/initialized` flow on stdio only; and
5. obtain its actual tool catalog with `tools/list`.

Do not run HTTP and stdio tool calls concurrently, do not duplicate an operation across them, and
do not infer stdio trust or permissions from an HTTP bearer token.

## Required AI-Tadpole client corrections

The successor to reviewed candidate revision `5afe7ed` must, at minimum:

- preserve structured HTTP/JSON-RPC errors so `-32022`, `data.supported`, and `data.requested` are
  available to the negotiation logic;
- select only an actual supported-version intersection and reject arbitrary first-advertised values;
- represent primary HTTP, fallback stdio, and `prefer_http` simultaneously and explicitly;
- apply the exact fallback matrix above instead of falling back after every discovery error;
- send per-request metadata and mirrored headers on every modern HTTP request;
- support JSON and request-scoped SSE with cancellation and per-request isolation;
- never send a legacy initialization request to `/mcp`; and
- add deterministic mock-server coverage before the GEV endpoint implementation starts.

## Evidence required to open Task 6.2

The AI-Tadpole-OS Rust/MCP maintainer must provide an immutable commit SHA descending from
`5afe7ed`. The joint integration owner must record the repository URL, base SHA, fix SHA, exact test
command, and passing output. A branch name or screenshot alone is not sufficient.

Minimum automated evidence:

- [ ] Both transports coexist in one parsed configuration with explicit `prefer_http`.
- [ ] Discovery sends the exact URL, version metadata, `Accept`, `Mcp-Method`, Host, and no Origin.
- [ ] A valid discovery selects only `2026-07-28`.
- [ ] A JSON response and a fragmented SSE response both complete correctly.
- [ ] Closing an SSE response cancels only its originating request; no cross-request events leak.
- [ ] Connection-refused and host-unreachable failures before any response select stdio.
- [ ] A structured `-32022` is preserved; mutual and absent intersections are tested.
- [ ] HTTP 401, 403, 404, 429, 5xx, governed denials, malformed bodies, timeouts, resets, TLS errors,
  cancellation, and ambiguous execution never select stdio.
- [ ] No legacy `initialize`, GET, DELETE, `/mcp/sse`, session ID, or replay header reaches `/mcp`.
- [ ] A tool is never dispatched twice or across both transports.
- [ ] Bearer tokens are sent only in `Authorization` and are redacted from all test logs.
- [ ] Invalid `x-mcp-header` definitions are excluded; valid values are mirrored and safely encoded.

Suggested evidence record:

```text
AI-Tadpole-OS repository: <immutable repository URL>
Reviewed base: 5afe7ed
Client-fix commit: <full SHA descending from 5afe7ed>
Test command: <exact command>
Result: <test count, zero failures>
Artifacts: <mock-server transcript/report path>
Joint integration owner: <role or approved identity>
Recorded at: <ISO-8601 timestamp>
```

## Local integration smoke sequence after Task 6.2 exists

Run this only in the approved local test profile and seed mode:

1. GEV owner enables `GEV_MCP_HTTP_ENABLED` for the test process and verifies a listener only on
   `127.0.0.1:3000`.
2. AI-Tadpole sends `server/discover`; verify port 3000 receives the request and returns modern
   discovery with `2026-07-28`.
3. AI-Tadpole sends `tools/list`; verify the list matches the injected token's scopes.
4. AI-Tadpole calls a read-only fixture-safe tool such as `get_budget` and validates both JSON and
   forced request-scoped SSE test paths.
5. Cancel a deliberately held SSE request and prove only that request aborts.
6. Stop the listener before discovery and prove connection refusal selects stdio.
7. Use mock responses for every forbidden fallback case and prove stdio is never started.

Do not perform a mutating or live-provider call merely to demonstrate transport alignment.

## Definition-of-alignment checklist

- [ ] The fixed profile and explicit configuration are implemented.
- [ ] HTTP request construction passes every header/body example and limit.
- [ ] Discovery, JSON, SSE, cancellation, and tool result parsing pass.
- [ ] Authorization is injected, audience-bound, scoped, and redacted.
- [ ] The fallback matrix is exhaustively unit-tested.
- [ ] The stdio fallback remains compatible with GEV's current `2024-11-05` server.
- [ ] The immutable successor commit and evidence record are supplied.
- [ ] Joint AI-Tadpole-to-GEV smoke evidence is recorded after the endpoint exists.

The first seven items satisfy the OQ-1 documentation/client-evidence gate and allow the previously
authorized Task 6.2 implementation to begin. The final item is subsequent Phase 6 conformance
evidence; it cannot exist before GEV implements the endpoint.

## Normative references

- [MCP 2026-07-28 Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [MCP 2026-07-28 versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
- [MCP 2026-07-28 server discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [MCP 2026-07-28 tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP 2026-07-28 authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP TypeScript SDK v2 modern protocol guidance](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)

