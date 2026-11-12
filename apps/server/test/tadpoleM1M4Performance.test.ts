import crypto from 'node:crypto';
import type { McpAuthorizationContext } from '@gev/contracts/mcp-authorization';
import { FrozenClock } from '@gev/core';
import {
  LocalSignedApprovalProvider,
  assertM1ToM3Prerequisites,
  createGovernanceRuntimeContext,
  generateEd25519KeyPair,
} from '@gev/governance';
import { afterEach, describe, expect, it } from 'vitest';
import { type CreatedApp, createApp } from '../src/index.js';
import { MCP_HTTP_HOST, MCP_HTTP_RESOURCE, MCP_TEST_ISSUER } from '../src/routes/mcp.js';

const NOW = 1_731_420_000_000;

function makeMcpAiIdentity(): McpAuthorizationContext {
  const nowSec = Math.floor(NOW / 1000);
  return {
    actor: 'ai',
    role: 'ai_copilot',
    principal: 'svc:tadpole-m4-bench',
    tenant_id: 'tenant-m4-bench',
    client_id: 'tadpole-runtime',
    token_id: 'mcp-bench-1',
    issuer: MCP_TEST_ISSUER,
    audience: MCP_HTTP_RESOURCE,
    resource: MCP_HTTP_RESOURCE,
    scopes: ['read.telemetry', 'write.flags'],
    issued_at_epoch_seconds: nowSec - 10,
    not_before_epoch_seconds: nowSec - 10,
    expires_at_epoch_seconds: nowSec + 240,
    task_ref: 'task-12-2-bench',
  };
}

describe('Task 12.2 Performance Benchmark: End-to-End M1->M2->M3->M4 < 10ms p95', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it('meets < 10ms p95 end-to-end M1->M2->M3->M4 governed invocation latency under FrozenClock', async () => {
    const clock = new FrozenClock(NOW);
    const approvalKeys = generateEd25519KeyPair();

    const governanceContext = createGovernanceRuntimeContext({
      clock,
      dbPath: ':memory:',
      capUsd: 25.0,
      signedApproval: {
        trustedKeys: [
          {
            signerId: 'human:ops-bench',
            keyId: 'bench-ed25519-v1',
            publicKeyPem: approvalKeys.publicKeyPem,
            status: 'active',
          },
        ],
        provider: new LocalSignedApprovalProvider({
          signerId: 'human:ops-bench',
          keyId: 'bench-ed25519-v1',
          privateKeyPem: approvalKeys.privateKeyPem,
          policy: 'approve_all',
          clock,
        }),
      },
    });

    const aiIdentity = makeMcpAiIdentity();
    const created: CreatedApp = createApp({
      clock,
      governanceContext,
      mcpHttpEnabled: true,
      mcpHttpResponseMode: 'json',
      mcpHttpBearerVerifier: {
        verify: async () => aiIdentity,
      },
    });
    cleanups.push(async () => {
      await created.mcpHttp?.close();
      governanceContext.close();
    });

    const capToken = governanceContext.capabilityIssuer.issue(
      aiIdentity.principal,
      ['read.telemetry', 'write.flags'],
      240
    );
    const session = governanceContext.connectionLifecycle.openSession({
      transport: 'http-2026-07-28',
      authorization: aiIdentity,
      capToken,
    });

    const mcpMetaBase = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'tadpole-bench', version: '1.0.0' },
      'io.modelcontextprotocol/clientCapabilities': {},
    };

    assertM1ToM3Prerequisites(governanceContext, {
      requireSignedApprovalGate: true,
      requireSharedAuthority: false,
    });

    const runOne = async (iteration: number) => {
      const res = await created.app.request(MCP_HTTP_RESOURCE, {
        method: 'POST',
        headers: {
          host: MCP_HTTP_HOST,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          authorization: 'Bearer bench-token',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': 'set_flag',
          'x-tadpole-cap-token': capToken.token,
          'x-tadpole-session-id': session.session_id,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `bench-${iteration}`,
          method: 'tools/call',
          params: {
            name: 'set_flag',
            arguments: { flag: 'opensky.enabled', enabled: iteration % 2 === 0 },
            _meta: { ...mcpMetaBase, operation_id: crypto.randomUUID() },
          },
        }),
      });
      expect(res.status).toBe(200);
    };

    // Warmup
    for (let w = 0; w < 10; w++) {
      await runOne(w);
    }

    const latencies: number[] = [];
    for (let i = 0; i < 60; i++) {
      const start = performance.now();
      await runOne(i + 10);
      latencies.push(performance.now() - start);
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? Number.POSITIVE_INFINITY;
    console.log(
      `[BENCHMARK] Task 12.2 E2E M1->M2->M3->M4 Governed MCP Mutation (N=60): p95=${p95.toFixed(3)}ms`
    );
    expect(p95).toBeLessThan(10.0);
  });
});
