import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';
import { MCP_HTTP_HOST, MCP_HTTP_RESOURCE, MCP_HTTP_RESOURCE_METADATA } from '../src/routes/mcp.js';
import {
  MCP_TEST_AUTHORIZATION,
  MCP_TEST_NOW,
  MCP_TEST_OTHER_SIGNING_KEY,
  fixedMcpBearerVerifier,
  issueSignedMcpToken,
  joseMcpBearerVerifier,
  testMcpAuthorization,
} from './mcpTestAuth.js';

const lifecycles: Array<ReturnType<typeof createApp>> = [];
const temporaryPaths: string[] = [];

function createAuthorizedApp(options: Parameters<typeof createApp>[0] = {}) {
  const created = createApp({
    clock: new FrozenClock(MCP_TEST_NOW),
    mcpHttpEnabled: true,
    mcpHttpResponseMode: 'json',
    mcpHttpBearerVerifier: joseMcpBearerVerifier(),
    ...options,
  });
  lifecycles.push(created);
  return created;
}

function requestInit(
  method: string,
  id: string,
  accessToken: string | undefined,
  params: Record<string, unknown> = {},
  body?: string
): RequestInit {
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    host: MCP_HTTP_HOST,
    'mcp-method': method,
    'mcp-protocol-version': '2026-07-28',
  });
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  if (method === 'tools/call' && typeof params.name === 'string') {
    headers.set('mcp-name', params.name);
  }
  return {
    method: 'POST',
    headers,
    body:
      body ??
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': {
              name: 'ai-tadpole-os',
              version: 'task-6.3-test',
            },
            'io.modelcontextprotocol/clientCapabilities': {},
            ...((params._meta as Record<string, unknown> | undefined) ?? {}),
          },
        },
      }),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

afterEach(async () => {
  for (const created of lifecycles.splice(0)) {
    await created.mcpHttp?.close();
    created.governanceContext.close();
  }
  for (const temporaryPath of temporaryPaths.splice(0)) {
    await fs.promises.rm(temporaryPath, { recursive: true, force: true });
  }
});

describe('scoped MCP HTTP authorization', () => {
  it('rejects every invalid signed or bearer form before SDK body dispatch', async () => {
    const { app, auditSink } = createAuthorizedApp();
    const invalidCases: Array<[string, string | undefined, string]> = [
      ['missing', undefined, MCP_HTTP_RESOURCE],
      ['malformed', 'not-a-jwt', MCP_HTTP_RESOURCE],
      [
        'invalid-signature',
        await issueSignedMcpToken({ signingKey: MCP_TEST_OTHER_SIGNING_KEY }),
        MCP_HTTP_RESOURCE,
      ],
      ['wrong-algorithm', await issueSignedMcpToken({ algorithm: 'HS384' }), MCP_HTTP_RESOURCE],
      [
        'wrong-issuer',
        await issueSignedMcpToken({ issuer: 'https://wrong.gev.test/' }),
        MCP_HTTP_RESOURCE,
      ],
      [
        'wrong-audience',
        await issueSignedMcpToken({ audience: `${MCP_HTTP_RESOURCE}/other` }),
        MCP_HTTP_RESOURCE,
      ],
      [
        'multiple-audiences',
        await issueSignedMcpToken({ audience: [MCP_HTTP_RESOURCE, `${MCP_HTTP_RESOURCE}/other`] }),
        MCP_HTTP_RESOURCE,
      ],
      [
        'wrong-resource',
        await issueSignedMcpToken({ resource: `${MCP_HTTP_RESOURCE}/other` }),
        MCP_HTTP_RESOURCE,
      ],
      [
        'future',
        await issueSignedMcpToken({
          issuedAt: MCP_TEST_NOW / 1000 + 60,
          notBefore: MCP_TEST_NOW / 1000 + 60,
          expiresAt: MCP_TEST_NOW / 1000 + 120,
        }),
        MCP_HTTP_RESOURCE,
      ],
      ['expired', await issueSignedMcpToken({ expiresAt: MCP_TEST_NOW / 1000 }), MCP_HTTP_RESOURCE],
      [
        'unknown-scope',
        await issueSignedMcpToken({ scopes: ['unknown.scope'] }),
        MCP_HTTP_RESOURCE,
      ],
      [
        'overlong-principal',
        await issueSignedMcpToken({ principal: `svc:${'p'.repeat(125)}` }),
        MCP_HTTP_RESOURCE,
      ],
      [
        'overlong-tenant',
        await issueSignedMcpToken({ tenantId: 't'.repeat(129) }),
        MCP_HTTP_RESOURCE,
      ],
      [
        'query-string',
        undefined,
        `${MCP_HTTP_RESOURCE}?access_token=${encodeURIComponent(await issueSignedMcpToken())}`,
      ],
    ];

    for (const [label, token, url] of invalidCases) {
      const response = await app.request(
        url,
        requestInit('tools/list', `invalid-${label}`, token, {}, '{')
      );
      expect(response.status, label).toBe(401);
      expect(response.headers.get('www-authenticate'), label).toContain('Bearer');
      expect(response.headers.get('www-authenticate'), label).toContain('error="invalid_token"');
      expect(response.headers.get('www-authenticate'), label).toContain(
        `resource_metadata="${MCP_HTTP_RESOURCE_METADATA}"`
      );
    }
    expect(auditSink.tail({ limit: 100 })).toEqual([]);
  });

  it('filters discovery/list per request and rejects a hidden direct call with scope guidance', async () => {
    const { app, auditSink } = createAuthorizedApp();
    const telemetryToken = await issueSignedMcpToken({
      principal: 'svc:telemetry-reader',
      tenantId: 'tenant-telemetry',
      scopes: ['read.telemetry'],
    });
    const auditToken = await issueSignedMcpToken({
      principal: 'svc:audit-reader',
      tenantId: 'tenant-audit',
      scopes: ['read.audit'],
    });

    const [telemetryList, auditList] = await Promise.all([
      app.request(MCP_HTTP_RESOURCE, requestInit('tools/list', 'list-telemetry', telemetryToken)),
      app.request(MCP_HTTP_RESOURCE, requestInit('tools/list', 'list-audit', auditToken)),
    ]);
    const telemetryTools = (
      (await readJson(telemetryList)).result as { tools: Array<{ name: string }> }
    ).tools;
    const auditTools = ((await readJson(auditList)).result as { tools: Array<{ name: string }> })
      .tools;
    expect(telemetryTools.map((tool) => tool.name)).toEqual(['get_feed_health', 'get_budget']);
    expect(auditTools.map((tool) => tool.name)).toEqual(['tail_logs']);

    const hidden = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('tools/call', 'hidden-call', telemetryToken, {
        name: 'run_diagnostics',
        arguments: {},
      })
    );
    expect(hidden.status).toBe(403);
    expect(hidden.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
    expect(hidden.headers.get('www-authenticate')).toContain('scope="read.audit"');
    expect(auditSink.tail({ limit: 10 })).toEqual([]);
  });

  it('propagates signed AI task identity and a stable operation through one audit lifecycle', async () => {
    const { app, auditSink } = createAuthorizedApp();
    const token = await issueSignedMcpToken({
      principal: 'svc:task-runner',
      tenantId: 'tenant-63',
      taskRef: 'task-6.3-signed-call',
      scopes: ['read.telemetry'],
    });
    const operationId = '00000000-0000-4000-8000-000000000063';
    const response = await app.request(
      MCP_HTTP_RESOURCE,
      requestInit('tools/call', 'authorized-call', token, {
        name: 'get_budget',
        arguments: {},
        _meta: { operation_id: operationId },
      })
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      result: { _meta: { execution: { intent_id: operationId, status: 'ok' } } },
    });
    expect(auditSink.tail({ limit: 10 })).toEqual([
      expect.objectContaining({
        kind: 'audit.intent',
        id: operationId,
        actor: 'ai',
        task_ref: 'task-6.3-signed-call',
      }),
      expect.objectContaining({
        kind: 'audit.outcome',
        intent_id: operationId,
        status: 'ok',
      }),
    ]);
  });

  it.each([
    '../outside.json',
    '..\\outside.json',
    'nested/scene.json',
    'nested\\scene.json',
    'C:\\outside.json',
    '\\\\server\\share\\scene.json',
    'scene.json:stream',
    'scene.txt',
  ])('preserves both remote scene path boundaries for %s', async (scenePath) => {
    const sceneRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gev-mcp-http-scenes-'));
    temporaryPaths.push(sceneRoot);
    const verifier = fixedMcpBearerVerifier({
      'deterministic-task-6-3-token': testMcpAuthorization({ scopes: ['write.scenes'] }),
    });
    const { app } = createAuthorizedApp({
      mcpHttpBearerVerifier: verifier,
      mcpSceneRoot: sceneRoot,
    });

    for (const [index, request] of [
      { name: 'save_scene', arguments: { save_path: scenePath } },
      { name: 'load_scene', arguments: { scene_path: scenePath } },
    ].entries()) {
      const response = await app.request(
        MCP_HTTP_RESOURCE,
        requestInit('tools/call', `scene-${index}`, MCP_TEST_AUTHORIZATION.slice(7), {
          ...request,
          _meta: {
            operation_id: `00000000-0000-4000-8000-${String(index + 64).padStart(12, '0')}`,
          },
        })
      );
      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({ result: { isError: true } });
    }
    expect(await fs.promises.readdir(sceneRoot)).toEqual([]);
  });
});
