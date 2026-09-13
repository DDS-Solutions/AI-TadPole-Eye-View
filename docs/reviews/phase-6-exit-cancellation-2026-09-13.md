# Phase 6 exit review — cancellation blocker

- Date: 2026-09-13
- Result: **DOC_BLOCKER — Phase 6 exit remains unchecked.**
- Certification branch: `codex/phase-6-certification-20260913`.
- Inspected tree: `737ccb73df8b549452324fe4ff39aea3f1713aec`, containing Task 6.7 implementation `3662f7f`.
- Fetched origin/main: `732c0f3`. The Phase 6 MCP, contracts, server, governance, and shared executor paths are unchanged from that merged tree. Tasks 6.6 and 6.7 remain local commits; this review does not claim their PR approval or merge.
- Runtime: Node 26.2.0, pnpm 10.34.5, Vitest 3.2.7; dependencies restored with the unchanged frozen lockfile.

## Finding

**[P1] A cancelled HTTP mutation can begin execution after approval resolves.**

The HTTP adapter passes principal, tenant, task, and operation identity to the shared executor but drops request cancellation. The core execution context has no cancellation signal. A mutation waiting for approval therefore proceeds to the ledger execution transition and handler even after its response stream closes. The route releases its active-request lease immediately, while this work remains alive.

The deterministic local probe below exercises the actual HTTP router, SDK adapter, shared executor, ledger, audit sink, and registered `set_flag` handler. It substitutes only a frozen clock and a deferred test approval/verifier, and observes the existing executor promise without changing execution. It opens no network listener and calls no external service. It waits on approval readiness, cancels the SSE body, and only then releases approval.

Observed result:

```json
{
  "transport": "text/event-stream",
  "activeRequestsAfterCancel": 0,
  "flagBeforeCancel": true,
  "flagAfterCancelAndApproval": false,
  "executionStatus": "ok",
  "executionSuccess": true,
  "ledgerState": "SETTLED",
  "auditEntries": 2
}
```

The assertion that the flag remains unchanged fails. Audit and approval are still present; the defect is cancellation failing to prevent later dispatch, with work no longer represented by the transport counter. Repeated cancelled requests could therefore leave outstanding approval/execution work outside that counter; this amplification was not load-tested.

Source locations:

- [HTTP adapter callback](../../packages/ops-mcp/src/httpAdapter.ts): lines 172–178 omit cancellation from executor context.
- [Execution context](../../packages/core/src/toolExecutionTypes.ts): context carries no signal.
- [Reserved execution](../../packages/core/src/reservedToolExecution.ts): approval resolves before the execution transition and handler, without cancellation checks.
- [HTTP response lease](../../apps/server/src/routes/mcp.ts): lines 229–235 abort and release the exchange independently of executor completion.
- [Existing adapter tests](../../packages/ops-mcp/test/httpAdapter.test.ts): the cancellation case closes a `tools/list` stream; it does not hold a mutation before dispatch.

The pinned [MCP Streamable HTTP cancellation specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#cancellation), rechecked on 2026-09-13, treats SSE stream closure as request cancellation and recommends promptly stopping its work. The authorized Phase 6 brief requires stream-close cancellation and bounded cleanup. The current behavior does not establish those exit claims.

## Completed verification

| Command / inspection | Result |
|---|---|
| Plan-copy diff | Identical |
| `pnpm lint` | 302 files, passed |
| `pnpm turbo run typecheck --force` | 17/17 tasks, uncached, passed |
| `pnpm turbo run test --force` | 16/16 tasks, 511 tests, uncached, passed |
| `pnpm test:performance` | 9/9 tests, passed |
| General / MCP 100-request load | 19.64 / 71.97 ms p95; peak MCP work 10 |
| NWS / AWC / NHC / CO-OPS parsers | 17.88 / 25.47 / 4.59 / 32.80 ms p95; ceiling 50 ms |
| Layer Access projection / filter | 2.34 / 3.93 ms p95; ceiling 16.6 ms |
| Cesium multi-layer / cable / satellite / operational ingestion | 6.89 / 4.76 / 3.52 / 7.68 ms p95; ceiling 16.6 ms |
| Tadpole implementation/evidence pins | Both exact commits resolve; all six source blobs match the GEV transcript pins |
| Cancellation probe | Expected preservation assertion fails with the result above |
| ADG / documentation tests | 69 documents, 526 paths, 18 symbols / 17 tests, passed |
| Registry parity / architecture / diff | Passed |

Unit totals: contracts 81, security 34, core 70, governance 49, providers 54, ops-mcp 53, CLI 16, server 137, cesium-kit 17. Existing golden stdio, pinned transcript, isolation, replay, denial, STASIS, and ambiguous-outcome tests pass. Those passing tests do not cover the delayed-approval cancellation defect.

The offline install first reported a missing Biome cache artifact. Frozen-lockfile restoration succeeded without manifest/lock changes. Restricted Turbo launch failed before execution; the unrestricted local rerun passed. Neither launcher failure is represented as a product failure.

The full production build, official Inspector/conformance rerun, Playwright, and fresh bundle/license certification were not completed in this review after the behavior blocker was established. Prior Task 6.7 and recovery results remain historical evidence. GitHub CLI is installed but unauthenticated; no open-PR or review-approval result is claimed.

The CLI needed a targeted build in the fresh checkout. Its final offline status is explicitly non-authoritative: STASIS_INACTIVE, seed mode, $10.00/$10.00 remaining, 20 healthy feeds and two unavailable. Existing governance state and both pre-existing worktrees were preserved.

## Reproduction

After `pnpm turbo run build --filter=@gev/server...`, save the following block as `cancellation-probe.mjs` at the repository root and run `node cancellation-probe.mjs`. On the inspected tree it exits 1 at the final assertion. The test approval is local and is not production authority.

```javascript
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.GEV_SEED_MODE = '1';
const [{ FrozenClock }, { createOperatorContext }, { createGevMcpHttpHandler }, { createMcpHttpRouter }] = await Promise.all([
  import('./packages/core/dist/index.js'),
  import('./packages/ops-mcp/dist/context.js'),
  import('./packages/ops-mcp/dist/httpAdapter.js'),
  import('./apps/server/dist/routes/mcp.js'),
]);
const now = 1_700_000_000_000;
const resource = 'http://127.0.0.1:3000/mcp';
const operation = '00000000-0000-4000-8000-000000006099';
const approvalRequested = Promise.withResolvers();
const approvalRelease = Promise.withResolvers();
const context = createOperatorContext({
  clock: new FrozenClock(now),
  approvalGate: {
    async request(request) {
      approvalRequested.resolve(request);
      await approvalRelease.promise;
      return { request_id: request.id, decision: 'approved', decided_by: 'human', decided_at: request.ts, signature: `sig-probe-${request.id}` };
    },
  },
});
let execution;
const originalExecute = context.toolExecutor.execute.bind(context.toolExecutor);
context.toolExecutor.execute = (...args) => {
  execution = originalExecute(...args);
  return execution;
};
const handler = createGevMcpHttpHandler({ context, responseMode: 'sse' });
const router = createMcpHttpRouter({
  handler,
  now: () => now,
  bearerVerifier: { async verify() { return {
    actor: 'ai', principal: 'svc:cancellation-probe', tenant_id: 'tenant-cancellation-probe',
    task_ref: 'phase-6-exit-cancellation-review', issuer: 'https://auth.gev.test/',
    audience: resource, resource, scopes: ['read.telemetry', 'read.audit', 'write.scenes', 'write.flags'],
    issued_at_epoch_seconds: now / 1000 - 60,
    not_before_epoch_seconds: now / 1000 - 60,
    expires_at_epoch_seconds: now / 1000 + 60,
  }; } },
});
const timeout = setTimeout(() => { console.error('Probe exceeded its 10-second bound'); process.exit(2); }, 10_000);
try {
  const request = new Request(resource, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3000', authorization: 'Bearer deterministic-local-probe',
      accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      'mcp-method': 'tools/call', 'mcp-name': 'set_flag', 'mcp-protocol-version': '2026-07-28',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'cancel-before-dispatch', method: 'tools/call', params: {
      name: 'set_flag', arguments: { flag: 'opensky.enabled', enabled: false },
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'phase-6-exit-probe', version: '1.0.0' },
        'io.modelcontextprotocol/clientCapabilities': {}, operation_id: operation },
    } }),
  });
  const response = await router.router.fetch(new Request('http://127.0.0.1:3000/', request));
  assert.equal(response.status, 200);
  await approvalRequested.promise;
  assert.equal(context.flags.get('opensky.enabled'), true);
  await response.body.cancel('client cancelled before approval completed');
  const activeAfterCancel = router.activeRequestCount();
  approvalRelease.resolve();
  const result = await execution;
  console.log(JSON.stringify({
    transport: response.headers.get('content-type'),
    activeRequestsAfterCancel: activeAfterCancel,
    flagBeforeCancel: true,
    flagAfterCancelAndApproval: context.flags.get('opensky.enabled'),
    executionStatus: result.status,
    executionSuccess: result.success,
    ledgerState: context.budgetLedger.lookup(operation)?.state,
    auditEntries: context.auditSink.tail({ limit: 10 }).length,
  }, null, 2));
  assert.equal(context.flags.get('opensky.enabled'), true, 'A tool cancelled before dispatch must not mutate after approval resolves');
} finally {
  clearTimeout(timeout);
  approvalRelease.resolve();
  await router.close();
  context.governanceContext.close();
}
```

## Required repair and next gate

The ready-to-authorize cancellation-repair 4-Pillar brief is in [PLAN.md](../../PLAN.md). It requires signal propagation through the sole governed execution path, cancellation before dispatch, bounded cleanup and accurate active-work accounting, durable non-replayable outcomes, and regression coverage for cancellation/approval/shutdown races. No product fix, new dependency, remote enablement, or Phase 7 work is included in this review.
