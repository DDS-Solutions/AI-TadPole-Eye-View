import type { McpAuthorizationContext } from '@gev/contracts/mcp-authorization';
import { FrozenClock, GovernedToolExecutor } from '@gev/core';
import {
  SqliteAuditSink,
  TadpoleCapabilityIssuer,
  TadpoleConnectionLifecycle,
} from '@gev/governance';
import { createOperatorContext } from '@gev/ops-mcp';
import { createGevMcpHttpHandler } from '@gev/ops-mcp/http';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MCP_HTTP_HOST,
  MCP_HTTP_RESOURCE,
  MCP_TEST_ISSUER,
  createMcpHttpRouter,
} from '../src/routes/mcp.js';

const NOW = 1_731_400_000_000;

function makeMcpAuth(scopes: ['read.telemetry', ...'read.audit'[]]): McpAuthorizationContext {
  const nowSec = Math.floor(NOW / 1000);
  return {
    actor: 'ai',
    role: 'ai_copilot',
    principal: 'svc:tadpole-m4',
    tenant_id: 'tenant-m4',
    client_id: 'tadpole-runtime',
    token_id: 'bearer-m4-1',
    issuer: MCP_TEST_ISSUER,
    audience: MCP_HTTP_RESOURCE,
    resource: MCP_HTTP_RESOURCE,
    scopes,
    issued_at_epoch_seconds: nowSec - 10,
    not_before_epoch_seconds: nowSec - 10,
    expires_at_epoch_seconds: nowSec + 240,
    task_ref: 'task-12-1-mcp',
  };
}

describe('Tadpole AgentEnvelope & Capability Propagation over MCP HTTP (Task 12.1)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it('enforces capability_scopes in GovernedToolExecutor preflight', async () => {
    const clock = new FrozenClock(NOW);
    const auditSink = new SqliteAuditSink({ clock, dbPath: ':memory:' });
    cleanups.push(() => auditSink.close());

    const executor = new GovernedToolExecutor({ clock, auditSink });
    executor.register('tail_logs', () => ({ entries: [], total: 0 }));

    const denied = await executor.execute(
      'tail_logs',
      { limit: 5 },
      {
        actor: 'ai',
        capability_scopes: ['read.telemetry'],
      }
    );
    expect(denied.success).toBe(false);
    expect(denied.code).toBe('CAPABILITY_DENIED');
    expect(denied.error).toContain('read.audit');
  });

  it('narrows MCP HTTP discovery and tool calls via x-tadpole-cap-token and x-tadpole-session-id', async () => {
    const clock = new FrozenClock(NOW);
    const context = createOperatorContext({ clock });
    const issuer = new TadpoleCapabilityIssuer({ clock });
    const lifecycle = new TadpoleConnectionLifecycle({
      clock,
      auditSink: context.auditSink,
      budgetGovernor: context.budgetGovernor,
      capabilityIssuer: issuer,
    });
    const handler = createGevMcpHttpHandler({ context, responseMode: 'json' });
    const auth = makeMcpAuth(['read.telemetry', 'read.audit']);
    const capToken = issuer.issue('svc:tadpole-m4', ['read.telemetry'], 180);
    const session = lifecycle.openSession({
      transport: 'http-2026-07-28',
      authorization: auth,
      capToken,
    });

    const route = createMcpHttpRouter({
      handler,
      now: () => clock.now(),
      capabilityIssuer: issuer,
      connectionLifecycle: lifecycle,
      bearerVerifier: {
        verify: async () => auth,
      },
    });
    const app = new Hono();
    app.route('/mcp', route.router);
    cleanups.push(async () => {
      await route.close();
      context.governanceContext.close();
    });

    const mcpMeta = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': {
        name: 'ai-tadpole-os',
        version: 'test-build',
      },
      'io.modelcontextprotocol/clientCapabilities': {},
    };

    // 1. tools/list narrowed to read.telemetry only (tail_logs & run_diagnostics excluded!)
    const listRes = await app.request(MCP_HTTP_RESOURCE, {
      method: 'POST',
      headers: {
        host: MCP_HTTP_HOST,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        authorization: 'Bearer valid-bearer-m4',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
        'x-tadpole-cap-token': capToken.token,
        'x-tadpole-session-id': session.session_id,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'list-1',
        method: 'tools/list',
        params: { _meta: mcpMeta },
      }),
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { result: { tools: Array<{ name: string }> } };
    expect(listBody.result.tools.some((t) => t.name === 'tail_logs')).toBe(false);
    expect(listBody.result.tools.some((t) => t.name === 'get_budget')).toBe(true);

    // 2. Direct call to read.audit tool rejected 403 insufficient_scope despite OAuth having read.audit
    const deniedRes = await app.request(MCP_HTTP_RESOURCE, {
      method: 'POST',
      headers: {
        host: MCP_HTTP_HOST,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        authorization: 'Bearer valid-bearer-m4',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'tail_logs',
        'x-tadpole-cap-token': capToken.token,
        'x-tadpole-session-id': session.session_id,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: { name: 'tail_logs', arguments: { limit: 5 }, _meta: mcpMeta },
      }),
    });
    expect(deniedRes.status).toBe(403);

    // 3. Revoked capability token rejected fail-closed with 401
    issuer.revoke(capToken);
    const revokedRes = await app.request(MCP_HTTP_RESOURCE, {
      method: 'POST',
      headers: {
        host: MCP_HTTP_HOST,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        authorization: 'Bearer valid-bearer-m4',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
        'x-tadpole-cap-token': capToken.token,
        'x-tadpole-session-id': session.session_id,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'list-2',
        method: 'tools/list',
        params: { _meta: mcpMeta },
      }),
    });
    expect(revokedRes.status).toBe(401);
  });
});
