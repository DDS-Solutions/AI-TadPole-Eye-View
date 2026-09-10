import type { McpAuthorizationContext } from '@gev/contracts/mcp-authorization';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type OperatorContext, createOperatorContext } from '../src/context.js';
import {
  MCP_HTTP_PROTOCOL_VERSION,
  createGevMcpHttpHandler,
  toGevMcpAuthInfo,
} from '../src/httpAdapter.js';

const CLIENT_INFO = { name: 'ai-tadpole-os', version: 'test-build' };
const RESOURCE = 'http://127.0.0.1:3000/mcp';
const AUTHORIZATION: McpAuthorizationContext = {
  actor: 'ai',
  principal: 'svc:tadpole-test',
  tenant_id: 'tenant-test',
  task_ref: 'task-6.3-http-adapter',
  issuer: 'https://auth.gev.test/',
  audience: RESOURCE,
  resource: RESOURCE,
  scopes: ['read.telemetry', 'read.audit', 'write.scenes', 'write.flags'],
  issued_at_epoch_seconds: 1_699_999_900,
  not_before_epoch_seconds: 1_699_999_900,
  expires_at_epoch_seconds: 1_700_000_100,
};
const contexts: OperatorContext[] = [];
const handlers: Array<ReturnType<typeof createGevMcpHttpHandler>> = [];

function createContext(): OperatorContext {
  const context = createOperatorContext({ clock: new FrozenClock(1_700_000_000_000) });
  contexts.push(context);
  return context;
}

function createHandler(responseMode: 'auto' | 'json' | 'sse' = 'auto') {
  const handler = createGevMcpHttpHandler({ context: createContext(), responseMode });
  handlers.push(handler);
  return handler;
}

function authorizedFetch(
  handler: ReturnType<typeof createGevMcpHttpHandler>,
  request: Request,
  authorization: McpAuthorizationContext = AUTHORIZATION
) {
  return handler.fetch(request, {
    authInfo: toGevMcpAuthInfo('signed-test-token', authorization),
  });
}

function modernRequest(
  method: string,
  id: string,
  bodyParams: Record<string, unknown> = {},
  options: { headerMethod?: string; version?: string; name?: string } = {}
): Request {
  const version = options.version ?? MCP_HTTP_PROTOCOL_VERSION;
  const params = {
    ...bodyParams,
    _meta: {
      'io.modelcontextprotocol/protocolVersion': version,
      'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
      'io.modelcontextprotocol/clientCapabilities': {},
      ...((bodyParams._meta as Record<string, unknown> | undefined) ?? {}),
    },
  };
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': version,
    'mcp-method': options.headerMethod ?? method,
  });
  if (options.name) headers.set('mcp-name', options.name);
  return new Request('http://127.0.0.1:3000/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function readSseMessages(response: Response): Promise<Array<Record<string, unknown>>> {
  const raw = await response.text();
  return raw.split(/\r?\n\r?\n/).flatMap((event) =>
    event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice('data:'.length).trim()) as Record<string, unknown>)
  );
}

afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.close()));
  while (contexts.length > 0) contexts.pop()?.governanceContext.close();
});

describe('modern MCP HTTP SDK adapter', () => {
  it('discovers only the modern protocol and advertises truthful tool capability', async () => {
    const response = await authorizedFetch(
      createHandler(),
      modernRequest('server/discover', 'discover-1')
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 'discover-1',
      result: {
        resultType: 'complete',
        supportedVersions: [MCP_HTTP_PROTOCOL_VERSION],
        capabilities: { tools: {} },
      },
    });
  });

  it('lists the registry-projected tools in their canonical order', async () => {
    const response = await authorizedFetch(createHandler(), modernRequest('tools/list', 'list-1'));
    const body = await readJson(response);
    const result = body.result as { tools: Array<{ name: string }> };

    expect(response.status).toBe(200);
    expect(result.tools.map((tool) => tool.name)).toEqual([
      'get_feed_health',
      'get_budget',
      'run_diagnostics',
      'load_scene',
      'save_scene',
      'tail_logs',
      'set_flag',
    ]);
  });

  it('calls through the governed executor and returns structured execution evidence', async () => {
    const handler = createHandler('json');
    const response = await authorizedFetch(
      handler,
      modernRequest(
        'tools/call',
        'call-1',
        {
          name: 'get_budget',
          arguments: {},
          _meta: { operation_id: '00000000-0000-4000-8000-000000000001' },
        },
        { name: 'get_budget' }
      )
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 'call-1',
      result: {
        resultType: 'complete',
        structuredContent: { stasis_active: false },
        _meta: { execution: { status: 'ok' } },
      },
    });
    expect(contexts[0]?.auditSink.tail({ limit: 10 }).map((entry) => entry.kind)).toEqual([
      'audit.intent',
      'audit.outcome',
    ]);
  });

  it('returns SDK protocol errors for unsupported versions and mirrored-header mismatch', async () => {
    const handler = createHandler();
    const unsupported = await authorizedFetch(
      handler,
      modernRequest('server/discover', 'unsupported-1', {}, { version: '2099-01-01' })
    );
    const mismatched = await authorizedFetch(
      handler,
      modernRequest('tools/list', 'mismatch-1', {}, { headerMethod: 'server/discover' })
    );

    expect(unsupported.status).toBe(400);
    expect(await readJson(unsupported)).toMatchObject({ error: { code: -32022 } });
    expect(mismatched.status).toBe(400);
    expect(await readJson(mismatched)).toMatchObject({ error: { code: -32020 } });
  });

  it('requires mirrored method/name headers and exact header/body agreement', async () => {
    const handler = createHandler();
    const missingMethod = modernRequest('tools/list', 'missing-method');
    missingMethod.headers.delete('mcp-method');
    const missingName = modernRequest(
      'tools/call',
      'missing-name',
      { name: 'get_budget', arguments: {} },
      { name: 'get_budget' }
    );
    missingName.headers.delete('mcp-name');
    const mismatchedVersion = modernRequest('tools/list', 'mismatched-version');
    mismatchedVersion.headers.set('mcp-protocol-version', '2099-01-01');

    for (const request of [missingMethod, missingName, mismatchedVersion]) {
      const response = await authorizedFetch(handler, request);
      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({ error: { code: -32020 } });
    }
  });

  it('enforces modern Content-Type through the official SDK', async () => {
    const handler = createHandler();
    const wrongType = modernRequest('tools/list', 'type-1');
    wrongType.headers.set('content-type', 'text/plain');

    const typeResponse = await authorizedFetch(handler, wrongType);
    expect(typeResponse.status).toBe(415);
  });

  it('serves request-scoped SSE without leaking one response into another', async () => {
    const handler = createHandler('sse');
    const first = await authorizedFetch(handler, modernRequest('tools/list', 'sse-1'));
    const second = await authorizedFetch(handler, modernRequest('server/discover', 'sse-2'));

    expect(first.headers.get('content-type')).toContain('text/event-stream');
    expect(second.headers.get('content-type')).toContain('text/event-stream');
    const [firstMessages, secondMessages] = await Promise.all([
      readSseMessages(first),
      readSseMessages(second),
    ]);
    expect(firstMessages.some((message) => message.id === 'sse-1')).toBe(true);
    expect(firstMessages.some((message) => message.id === 'sse-2')).toBe(false);
    expect(secondMessages.some((message) => message.id === 'sse-2')).toBe(true);
    expect(secondMessages.some((message) => message.id === 'sse-1')).toBe(false);
  });

  it('closes one request stream without cancelling another and shuts down cleanly', async () => {
    const handler = createHandler('sse');
    const cancelled = await authorizedFetch(handler, modernRequest('tools/list', 'cancel-1'));
    const retained = await authorizedFetch(handler, modernRequest('tools/list', 'retain-1'));

    await cancelled.body?.cancel('client disconnected');
    const retainedMessages = await readSseMessages(retained);
    expect(retainedMessages.some((message) => message.id === 'retain-1')).toBe(true);
    await expect(handler.close()).resolves.toBeUndefined();
  });

  it('projects per-request scopes and fails closed without validated request authority', async () => {
    const handler = createHandler('json');
    const telemetryOnly = {
      ...AUTHORIZATION,
      principal: 'svc:telemetry-reader',
      tenant_id: 'tenant-reader',
      scopes: ['read.telemetry'] as const,
    };
    const authorized = await authorizedFetch(
      handler,
      modernRequest('tools/list', 'scoped-list'),
      telemetryOnly
    );
    const unauthorized = await handler.fetch(modernRequest('tools/list', 'unscoped-list'));

    expect(
      ((await readJson(authorized)).result as { tools: Array<{ name: string }> }).tools.map(
        (tool) => tool.name
      )
    ).toEqual(['get_feed_health', 'get_budget']);
    expect(await readJson(unauthorized)).toMatchObject({ error: { code: -32601 } });
  });

  it('keeps concurrent principal, tenant, task, and operation context request-local', async () => {
    const context = createOperatorContext({ clock: new FrozenClock(1_700_000_000_000) });
    contexts.push(context);
    const execute = vi.spyOn(context.toolExecutor, 'execute');
    const handler = createGevMcpHttpHandler({ context, responseMode: 'json' });
    handlers.push(handler);
    const firstOperation = '00000000-0000-4000-8000-000000000063';
    const secondOperation = '00000000-0000-4000-8000-000000000064';
    const secondAuthorization: McpAuthorizationContext = {
      ...AUTHORIZATION,
      principal: 'svc:audit-reader',
      tenant_id: 'tenant-audit',
      task_ref: 'task-6.3-audit-reader',
      scopes: ['read.audit'],
    };

    const [first, second] = await Promise.all([
      authorizedFetch(
        handler,
        modernRequest(
          'tools/call',
          'identity-1',
          {
            name: 'get_budget',
            arguments: {},
            _meta: { operation_id: firstOperation },
          },
          { name: 'get_budget' }
        )
      ),
      authorizedFetch(
        handler,
        modernRequest(
          'tools/call',
          'identity-2',
          {
            name: 'tail_logs',
            arguments: { limit: 10 },
            _meta: { operation_id: secondOperation },
          },
          { name: 'tail_logs' }
        ),
        secondAuthorization
      ),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map((call) => call[2])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principal: 'svc:tadpole-test',
          tenant_id: 'tenant-test',
          task_ref: 'task-6.3-http-adapter',
          operation_id: firstOperation,
        }),
        expect.objectContaining({
          principal: 'svc:audit-reader',
          tenant_id: 'tenant-audit',
          task_ref: 'task-6.3-audit-reader',
          operation_id: secondOperation,
        }),
      ])
    );
  });
});
