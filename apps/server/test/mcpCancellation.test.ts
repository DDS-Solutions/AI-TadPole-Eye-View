import type { ApprovalGate, ApprovalResult } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { createOperatorContext } from '@gev/ops-mcp';
import { createGevMcpHttpHandler } from '@gev/ops-mcp/http';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index.js';
import { MCP_HTTP_HOST, MCP_HTTP_RESOURCE, createMcpHttpRouter } from '../src/routes/mcp.js';
import {
  MCP_TEST_AUTHORIZATION as AUTHORIZATION,
  MCP_TEST_NOW as NOW,
  fixedMcpBearerVerifier,
} from './mcpTestAuth.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function requestInit(
  method: string,
  id: string,
  params: Record<string, unknown> = {}
): RequestInit {
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    authorization: AUTHORIZATION,
    'content-type': 'application/json',
    host: MCP_HTTP_HOST,
    'mcp-method': method,
    'mcp-protocol-version': '2026-07-28',
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

function approvedDecision(): ApprovalResult {
  return {
    request_id: 'replaced-by-gate',
    decision: 'approved',
    signature: 'late-test-signature',
    decided_by: 'human',
    decided_at: new Date(NOW).toISOString(),
  };
}

function createExecutionHarness(paths: readonly string[], maximum = paths.length) {
  const clock = new FrozenClock(NOW);
  const governanceContext = createGovernanceRuntimeContext({ clock, dbPath: ':memory:' });
  const context = createOperatorContext({ clock, governanceContext });
  const handler = createGevMcpHttpHandler({ context, responseMode: 'sse' });
  const lifecycle = createMcpHttpRouter({
    handler,
    now: () => clock.now(),
    bearerVerifier: fixedMcpBearerVerifier(),
    maxActiveRequests: maximum,
  });
  const app = new Hono();
  app.route('/mcp', lifecycle.router);
  const controls = new Map(
    paths.map((path) => [
      path,
      {
        started: deferred<void>(),
        finish: deferred<void>(),
        signal: undefined as AbortSignal | undefined,
      },
    ])
  );
  context.toolExecutor.register('save_scene', async (input, executionContext) => {
    const control = controls.get(input.save_path);
    if (!control) throw new Error(`Missing test control for ${input.save_path}`);
    control.signal = executionContext.signal;
    control.started.resolve();
    await control.finish.promise;
    return {
      saved: true,
      scene_path: input.save_path,
      summary: {
        version: 1,
        layer_count: 0,
        enabled_layer_count: 0,
        aoi_count: 0,
        camera_altitude: 1,
        selected_entity: null,
      },
    };
  });
  return { app, context, controls, lifecycle };
}

describe('MCP HTTP cancellation lifecycle', () => {
  it('cancels pending approval, refunds once, and never dispatches after late approval', async () => {
    const approvalStarted = deferred<void>();
    const approvalDecision = deferred<ApprovalResult>();
    const approvalGate: ApprovalGate = {
      request: (request) => {
        approvalStarted.resolve();
        return approvalDecision.promise.then((approval) => ({
          ...approval,
          request_id: request.id,
        }));
      },
    };
    const approval = vi.spyOn(approvalGate, 'request');
    const clock = new FrozenClock(NOW);
    const governanceContext = createGovernanceRuntimeContext({
      clock,
      dbPath: ':memory:',
      approvalGate,
    });
    const created = createApp({
      clock,
      governanceContext,
      mcpHttpEnabled: true,
      mcpHttpBearerVerifier: fixedMcpBearerVerifier(),
      mcpHttpMaxActiveRequests: 1,
      mcpHttpResponseMode: 'sse',
    });
    const operationId = '00000000-0000-4000-8000-000000000093';

    try {
      const first = await created.app.request(
        MCP_HTTP_RESOURCE,
        requestInit('tools/call', 'cancel-approval', {
          name: 'set_flag',
          arguments: { flag: 'opensky.enabled', enabled: false },
          _meta: { operation_id: operationId },
        })
      );
      await approvalStarted.promise;
      expect(created.mcpHttp?.activeRequestCount()).toBe(1);

      await first.body?.cancel('client disconnected');

      expect(created.mcpHttp?.activeRequestCount()).toBe(0);
      expect(created.governanceContext.budgetLedger.lookup(operationId)).toMatchObject({
        state: 'REFUNDED',
        settled_microusd: 0,
        terminal_result: { code: 'REQUEST_CANCELLED', retryable: false },
      });
      expect(created.auditSink.tail({ limit: 10 })).toHaveLength(2);

      approvalDecision.resolve(approvedDecision());
      await Promise.resolve();
      const replay = await created.app.request(
        MCP_HTTP_RESOURCE,
        requestInit('tools/call', 'replay-cancelled-approval', {
          name: 'set_flag',
          arguments: { flag: 'opensky.enabled', enabled: false },
          _meta: { operation_id: operationId },
        })
      );

      expect(await replay.text()).toContain('REQUEST_CANCELLED');
      expect(approval).toHaveBeenCalledTimes(1);
      expect(created.governanceContext.budgetLedger.lookup(operationId)?.state).toBe('REFUNDED');
      expect(created.auditSink.tail({ limit: 10 })).toHaveLength(2);
    } finally {
      approvalDecision.resolve(approvedDecision());
      await created.mcpHttp?.close();
      created.governanceContext.close();
    }
  });

  it('keeps cancelled execution counted and leaves an unrelated request running', async () => {
    const created = createExecutionHarness(['first.json', 'second.json'], 2);
    const firstOperation = '00000000-0000-4000-8000-000000000091';
    const secondOperation = '00000000-0000-4000-8000-000000000092';

    try {
      const [first, second] = await Promise.all([
        created.app.request(
          MCP_HTTP_RESOURCE,
          requestInit('tools/call', 'running-first', {
            name: 'save_scene',
            arguments: { save_path: 'first.json' },
            _meta: { operation_id: firstOperation },
          })
        ),
        created.app.request(
          MCP_HTTP_RESOURCE,
          requestInit('tools/call', 'running-second', {
            name: 'save_scene',
            arguments: { save_path: 'second.json' },
            _meta: { operation_id: secondOperation },
          })
        ),
      ]);
      await Promise.all([
        created.controls.get('first.json')?.started.promise,
        created.controls.get('second.json')?.started.promise,
      ]);
      expect(created.lifecycle.activeRequestCount()).toBe(2);

      const cancellation = first.body?.cancel('client disconnected');
      await vi.waitFor(() =>
        expect(created.controls.get('first.json')?.signal?.aborted).toBe(true)
      );

      expect(created.controls.get('second.json')?.signal?.aborted).toBe(false);
      expect(created.lifecycle.activeRequestCount()).toBe(2);
      const limited = await created.app.request(
        MCP_HTTP_RESOURCE,
        requestInit('tools/list', 'cannot-evade-bound')
      );
      expect(limited.status).toBe(429);
      expect(created.context.budgetLedger.lookup(firstOperation)?.state).toBe('IN_DOUBT');

      created.controls.get('first.json')?.finish.resolve();
      await cancellation;
      expect(created.lifecycle.activeRequestCount()).toBe(1);
      expect(created.controls.get('second.json')?.signal?.aborted).toBe(false);

      created.controls.get('second.json')?.finish.resolve();
      expect(await second.text()).toContain('running-second');
      expect(created.lifecycle.activeRequestCount()).toBe(0);
      expect(created.context.budgetLedger.lookup(firstOperation)?.state).toBe('IN_DOUBT');
      expect(created.context.budgetLedger.lookup(secondOperation)?.state).toBe('SETTLED');

      const auditCount = created.context.auditSink.tail({ limit: 10 }).length;
      const replay = await created.app.request(
        MCP_HTTP_RESOURCE,
        requestInit('tools/call', 'replay-in-doubt', {
          name: 'save_scene',
          arguments: { save_path: 'first.json' },
          _meta: { operation_id: firstOperation },
        })
      );
      expect(await replay.text()).toContain('OPERATION_IN_DOUBT');
      expect(created.context.auditSink.tail({ limit: 10 })).toHaveLength(auditCount);
    } finally {
      for (const control of created.controls.values()) control.finish.resolve();
      await created.lifecycle.close();
      created.context.governanceContext.close();
    }
  });

  it('keeps shutdown pending until dispatched work has stopped', async () => {
    const created = createExecutionHarness(['shutdown.json'], 1);
    const operationId = '00000000-0000-4000-8000-000000000090';

    try {
      await created.app.request(
        MCP_HTTP_RESOURCE,
        requestInit('tools/call', 'shutdown-running', {
          name: 'save_scene',
          arguments: { save_path: 'shutdown.json' },
          _meta: { operation_id: operationId },
        })
      );
      await created.controls.get('shutdown.json')?.started.promise;

      let closed = false;
      const closing = created.lifecycle.close().then(() => {
        closed = true;
      });
      await vi.waitFor(() =>
        expect(created.controls.get('shutdown.json')?.signal?.aborted).toBe(true)
      );
      await vi.waitFor(() =>
        expect(created.context.budgetLedger.lookup(operationId)?.state).toBe('IN_DOUBT')
      );

      expect(closed).toBe(false);
      expect(created.lifecycle.activeRequestCount()).toBe(1);
      const rejected = await created.app.request(
        MCP_HTTP_RESOURCE,
        requestInit('tools/list', 'after-close')
      );
      expect(rejected.status).toBe(503);

      created.controls.get('shutdown.json')?.finish.resolve();
      await closing;
      expect(closed).toBe(true);
      expect(created.lifecycle.activeRequestCount()).toBe(0);
    } finally {
      created.controls.get('shutdown.json')?.finish.resolve();
      await created.lifecycle.close();
      created.context.governanceContext.close();
    }
  });
});
