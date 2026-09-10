import type { McpBearerVerifier } from '@gev/contracts/mcp-authorization';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index.js';
import {
  MCP_HTTP_HOST,
  MCP_HTTP_MAX_BODY_BYTES,
  MCP_HTTP_MAX_HEADER_BYTES,
  MCP_HTTP_RESOURCE,
} from '../src/routes/mcp.js';
import {
  MCP_TEST_AUTHORIZATION as AUTHORIZATION,
  MCP_TEST_NOW as NOW,
  fixedMcpBearerVerifier,
  testMcpAuthorization,
} from './mcpTestAuth.js';

const lifecycles: Array<ReturnType<typeof createApp>> = [];

function createMcpApp(
  options: {
    verifier?: McpBearerVerifier;
    maxActiveRequests?: number;
    responseMode?: 'auto' | 'json' | 'sse';
  } = {}
) {
  const created = createApp({
    clock: new FrozenClock(NOW),
    mcpHttpEnabled: true,
    mcpHttpBearerVerifier: options.verifier,
    mcpHttpMaxActiveRequests: options.maxActiveRequests,
    mcpHttpResponseMode: options.responseMode,
  });
  lifecycles.push(created);
  return created;
}

function requestInit(
  method: string,
  id: string,
  params: Record<string, unknown> = {},
  overrides: Record<string, string> = {}
): RequestInit {
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    authorization: AUTHORIZATION,
    'content-type': 'application/json',
    host: MCP_HTTP_HOST,
    'mcp-method': method,
    'mcp-protocol-version': '2026-07-28',
    ...overrides,
  });
  if (method === 'tools/call' && typeof params.name === 'string') {
    headers.set('mcp-name', params.name);
  }
  return {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'ai-tadpole-os',
            version: 'test-build',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
          ...((params._meta as Record<string, unknown> | undefined) ?? {}),
        },
      },
    }),
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

afterEach(async () => {
  for (const created of lifecycles.splice(0)) {
    await created.mcpHttp?.close();
    created.governanceContext.close();
  }
  vi.unstubAllEnvs();
});

describe('local modern MCP HTTP route', () => {
  it('is absent by default and fails closed without an injected bearer verifier', async () => {
    const disabled = createApp({ clock: new FrozenClock(NOW), mcpHttpEnabled: false });
    lifecycles.push(disabled);
    const disabledResponse = await disabled.app.request(
      MCP_HTTP_RESOURCE,
      requestInit('server/discover', 'disabled-1')
    );
    const unconfigured = createMcpApp();
    const unconfiguredResponse = await unconfigured.app.request(
      MCP_HTTP_RESOURCE,
      requestInit('server/discover', 'unconfigured-1')
    );

    expect(disabledResponse.status).toBe(404);
    expect(unconfiguredResponse.status).toBe(503);
  });

  it('ignores an injected bearer verifier in production mode', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { app } = createMcpApp({ verifier: fixedMcpBearerVerifier() });
    const response = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('server/discover', 'production-1')
    );

    expect(response.status).toBe(503);
  });

  it('rejects invalid Origin, Host, token, and issuance window before dispatch', async () => {
    const { app } = createMcpApp({ verifier: fixedMcpBearerVerifier() });
    const origin = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('server/discover', 'origin-1', {}, { origin: 'http://localhost:5173' })
    );
    const host = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('server/discover', 'host-1', {}, { host: 'localhost:3000' })
    );
    const token = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('server/discover', 'token-1', {}, { authorization: 'Bearer wrong' })
    );

    expect(origin.status).toBe(403);
    expect(host.status).toBe(403);
    expect(token.status).toBe(401);

    const expired = createMcpApp({
      verifier: fixedMcpBearerVerifier({
        'deterministic-task-6-3-token': testMcpAuthorization({
          expires_at_epoch_seconds: NOW / 1000,
        }),
      }),
    });
    const expiredResponse = await expired.app.request(
      MCP_HTTP_RESOURCE,
      requestInit('server/discover', 'expired-1')
    );
    expect(expiredResponse.status).toBe(401);
  });

  it('returns 405 for unsupported methods and requires both response media types', async () => {
    const { app } = createMcpApp({ verifier: fixedMcpBearerVerifier() });
    for (const method of ['GET', 'DELETE']) {
      const response = await app.request(MCP_HTTP_RESOURCE, {
        method,
      });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }

    const legacyRoute = await app.request(`${MCP_HTTP_RESOURCE}/sse`);
    expect(legacyRoute.status).toBe(404);

    const response = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('server/discover', 'accept-1', {}, { accept: 'application/json' })
    );
    expect(response.status).toBe(406);
  });

  it('requires protocol, method, and tool-name mirrored headers before dispatch', async () => {
    const { app, auditSink } = createMcpApp({ verifier: fixedMcpBearerVerifier() });
    const missingVersion = requestInit('tools/list', 'missing-version');
    (missingVersion.headers as Headers).delete('mcp-protocol-version');
    const missingMethod = requestInit('tools/list', 'missing-method');
    (missingMethod.headers as Headers).delete('mcp-method');
    const missingName = requestInit('tools/call', 'missing-name', {
      name: 'get_budget',
      arguments: {},
    });
    (missingName.headers as Headers).delete('mcp-name');

    for (const init of [missingVersion, missingMethod, missingName]) {
      const response = await app.request(MCP_HTTP_RESOURCE, init);
      expect(response.status).toBe(400);
      expect(await json(response)).toMatchObject({ error: { code: -32020 } });
    }
    expect(auditSink.tail({ limit: 10 })).toEqual([]);
  });

  it('rejects oversized headers and legacy session/replay headers', async () => {
    const { app, auditSink } = createMcpApp({ verifier: fixedMcpBearerVerifier() });
    const oversized = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit(
        'tools/list',
        'headers-1',
        {},
        { 'x-oversized': 'x'.repeat(MCP_HTTP_MAX_HEADER_BYTES) }
      )
    );
    const session = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('tools/list', 'session-1', {}, { 'mcp-session-id': 'legacy-session' })
    );
    const replay = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('tools/list', 'replay-1', {}, { 'last-event-id': 'legacy-event' })
    );

    expect(oversized.status).toBe(431);
    expect(session.status).toBe(400);
    expect(replay.status).toBe(400);
    expect(auditSink.tail({ limit: 10 })).toEqual([]);
  });

  it('serves discovery, list, and a governed structured call over JSON', async () => {
    const { app, auditSink } = createMcpApp({
      verifier: fixedMcpBearerVerifier(),
      responseMode: 'json',
    });
    const discovery = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('server/discover', 'discover-1')
    );
    const list = await app.request(MCP_HTTP_RESOURCE, requestInit('tools/list', 'list-1'));
    const call = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('tools/call', 'call-1', {
        name: 'get_budget',
        arguments: {},
        _meta: { operation_id: '00000000-0000-4000-8000-000000000001' },
      })
    );

    expect(discovery.status).toBe(200);
    expect(await json(discovery)).toMatchObject({
      result: {
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: { listChanged: false } },
      },
    });
    expect(list.status).toBe(200);
    const listedTools = ((await json(list)).result as { tools: Array<Record<string, unknown>> })
      .tools;
    expect(listedTools).toHaveLength(7);
    expect(listedTools.find((tool) => tool.name === 'get_budget')).toMatchObject({
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
    });
    expect(call.status).toBe(200);
    const callBody = await json(call);
    expect(callBody).toMatchObject({
      result: {
        resultType: 'complete',
        structuredContent: { stasis_active: false },
        _meta: { execution: { status: 'ok' } },
      },
    });
    const callResult = callBody.result as {
      content: Array<{ type: string; text?: string }>;
      structuredContent: unknown;
    };
    expect(JSON.parse(callResult.content[0]?.text ?? '{}')).toEqual(callResult.structuredContent);
    expect(auditSink.tail({ limit: 10 }).map((entry) => entry.kind)).toEqual([
      'audit.intent',
      'audit.outcome',
    ]);
  });

  it('preserves official protocol and media-type errors', async () => {
    const { app } = createMcpApp({ verifier: fixedMcpBearerVerifier() });
    const mismatch = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('tools/list', 'mismatch-1', {}, { 'mcp-method': 'server/discover' })
    );
    const wrongType = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('tools/list', 'type-1', {}, { 'content-type': 'text/plain' })
    );

    expect(mismatch.status).toBe(400);
    expect(await json(mismatch)).toMatchObject({ error: { code: -32020 } });
    expect(wrongType.status).toBe(415);
  });

  it('preserves the SDK parse error for malformed bounded JSON', async () => {
    const { app, auditSink } = createMcpApp({ verifier: fixedMcpBearerVerifier() });
    const init = requestInit('tools/list', 'malformed-1');
    init.body = '{';
    const response = await app.request(MCP_HTTP_RESOURCE, init);

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: { code: -32700 } });
    expect(auditSink.tail({ limit: 10 })).toEqual([]);
  });

  it('rejects a body above 1 MiB without dispatching it', async () => {
    const { app, auditSink } = createMcpApp({ verifier: fixedMcpBearerVerifier() });
    const response = await app.request(MCP_HTTP_RESOURCE, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: AUTHORIZATION,
        'content-type': 'application/json',
        host: MCP_HTTP_HOST,
        'mcp-method': 'tools/list',
        'mcp-protocol-version': '2026-07-28',
      },
      body: 'x'.repeat(MCP_HTTP_MAX_BODY_BYTES + 1),
    });

    expect(response.status).toBe(413);
    expect(auditSink.tail({ limit: 10 })).toEqual([]);
  });

  it('bounds active response streams and releases only the cancelled request', async () => {
    const created = createMcpApp({
      verifier: fixedMcpBearerVerifier(),
      maxActiveRequests: 1,
      responseMode: 'sse',
    });
    const first = await created.app.request(
      MCP_HTTP_RESOURCE,
      requestInit('tools/list', 'stream-1')
    );
    expect(created.mcpHttp?.activeRequestCount()).toBe(1);

    const limited = await created.app.request(
      MCP_HTTP_RESOURCE,
      requestInit('tools/list', 'stream-2')
    );
    expect(limited.status).toBe(429);

    await first.body?.cancel('client disconnected');
    expect(created.mcpHttp?.activeRequestCount()).toBe(0);
    const retained = await created.app.request(
      MCP_HTTP_RESOURCE,
      requestInit('tools/list', 'stream-3')
    );
    expect(retained.status).toBe(200);
    expect(await retained.text()).toContain('stream-3');
    expect(created.mcpHttp?.activeRequestCount()).toBe(0);
  });

  it('aborts active streams on shutdown and rejects subsequent work', async () => {
    const created = createMcpApp({ verifier: fixedMcpBearerVerifier(), responseMode: 'sse' });
    const active = await created.app.request(
      MCP_HTTP_RESOURCE,
      requestInit('tools/list', 'shutdown-1')
    );
    expect(created.mcpHttp?.activeRequestCount()).toBe(1);

    await created.mcpHttp?.close();
    expect(created.mcpHttp?.activeRequestCount()).toBe(0);
    await active.body?.cancel().catch(() => undefined);
    const afterClose = await created.app.request(
      MCP_HTTP_RESOURCE,
      requestInit('tools/list', 'shutdown-2')
    );
    expect(afterClose.status).toBe(503);
  });
});
