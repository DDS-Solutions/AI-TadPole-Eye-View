import type { ApprovalGate } from '@gev/contracts';
import type { McpAuthorizationContext } from '@gev/contracts/mcp-authorization';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type OperatorContext, createOperatorContext } from '../src/context.js';
import {
  MCP_HTTP_PROTOCOL_VERSION,
  createGevMcpHttpHandler,
  toGevMcpAuthInfo,
} from '../src/httpAdapter.js';

const NOW = 1_700_000_000_000;
const RESOURCE = 'http://127.0.0.1:3000/mcp';
const AUTHORIZATION: McpAuthorizationContext = {
  actor: 'ai',
  principal: 'svc:tadpole-test',
  tenant_id: 'tenant-task-6-5',
  task_ref: 'task-6.5-conformance-matrix',
  issuer: 'https://auth.gev.test/',
  audience: RESOURCE,
  resource: RESOURCE,
  scopes: ['read.telemetry', 'read.audit', 'write.scenes', 'write.flags'],
  issued_at_epoch_seconds: NOW / 1000 - 60,
  not_before_epoch_seconds: NOW / 1000 - 60,
  expires_at_epoch_seconds: NOW / 1000 + 60,
};
const contexts: OperatorContext[] = [];
const handlers: Array<ReturnType<typeof createGevMcpHttpHandler>> = [];

function approvalGate(decision: 'approved' | 'denied'): ApprovalGate {
  return {
    request: async (request) => ({
      request_id: request.id,
      decision,
      decided_by: 'human',
      decided_at: request.ts,
      ...(decision === 'approved' ? { signature: `sig-task-6-5-${request.id}` } : {}),
    }),
  };
}

function setup(decision: 'approved' | 'denied' = 'approved') {
  const context = createOperatorContext({
    clock: new FrozenClock(NOW),
    approvalGate: approvalGate(decision),
  });
  const handler = createGevMcpHttpHandler({ context, responseMode: 'json' });
  contexts.push(context);
  handlers.push(handler);
  return { context, handler };
}

function toolCall(operationId: string, requestId: string): Request {
  const method = 'tools/call';
  return new Request(RESOURCE, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-method': method,
      'mcp-name': 'set_flag',
      'mcp-protocol-version': MCP_HTTP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method,
      params: {
        name: 'set_flag',
        arguments: { flag: 'opensky.enabled', enabled: false },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MCP_HTTP_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': {
            name: 'ai-tadpole-os',
            version: '1.1.462',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
          operation_id: operationId,
        },
      },
    }),
  });
}

async function call(
  handler: ReturnType<typeof createGevMcpHttpHandler>,
  operationId: string,
  requestId: string
) {
  const response = await handler.fetch(toolCall(operationId, requestId), {
    authInfo: toGevMcpAuthInfo('deterministic-test-token', AUTHORIZATION),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    result: {
      isError?: boolean;
      structuredContent?: unknown;
      _meta: { execution: { code?: string; replayed: boolean; status: string } };
    };
  };
}

afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.close()));
  while (contexts.length > 0) contexts.pop()?.governanceContext.close();
});

describe('Task 6.5 governed HTTP conformance matrix', () => {
  it('replays one stable operation without a second handler, audit pair, or charge', async () => {
    const { context, handler } = setup();
    const operationId = '00000000-0000-4000-8000-000000000650';
    const dispatch = vi.fn(async () => ({
      flag: 'opensky.enabled',
      enabled: false,
      updated: true,
    }));
    context.toolExecutor.register('set_flag', dispatch);

    const first = await call(handler, operationId, 'first');
    const replay = await call(handler, operationId, 'replay');

    expect(first.result).toMatchObject({
      structuredContent: { flag: 'opensky.enabled', enabled: false, updated: true },
      _meta: { execution: { status: 'ok', replayed: false } },
    });
    expect(replay.result).toMatchObject({
      structuredContent: first.result.structuredContent,
      _meta: { execution: { status: 'ok', replayed: true } },
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(context.auditSink.tail({ limit: 10 })).toHaveLength(2);
    expect(context.budgetLedger.lookup(operationId)?.state).toBe('SETTLED');
    expect(context.budgetGovernor.state().spent_usd).toBe(0);
  });

  it('replays an approval denial without dispatching or requesting approval again', async () => {
    const { context, handler } = setup('denied');
    const operationId = '00000000-0000-4000-8000-000000000651';
    const approval = vi.spyOn(context.approvalGate, 'request');
    const dispatch = vi.fn(async () => ({
      flag: 'opensky.enabled',
      enabled: false,
      updated: true,
    }));
    context.toolExecutor.register('set_flag', dispatch);

    const first = await call(handler, operationId, 'denied-first');
    const replay = await call(handler, operationId, 'denied-replay');

    expect(first.result).toMatchObject({
      isError: true,
      _meta: { execution: { status: 'blocked', code: 'APPROVAL_DENIED', replayed: false } },
    });
    expect(replay.result).toMatchObject({
      isError: true,
      _meta: { execution: { status: 'blocked', code: 'APPROVAL_DENIED', replayed: true } },
    });
    expect(approval).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(context.auditSink.tail({ limit: 10 })).toHaveLength(2);
    expect(context.budgetLedger.lookup(operationId)?.state).toBe('REFUNDED');
  });

  it('denies under STASIS before approval or handler dispatch and stores the budget result', async () => {
    const { context, handler } = setup();
    const operationId = '00000000-0000-4000-8000-000000000652';
    const approval = vi.spyOn(context.approvalGate, 'request');
    const dispatch = vi.fn(async () => ({
      flag: 'opensky.enabled',
      enabled: false,
      updated: true,
    }));
    context.toolExecutor.register('set_flag', dispatch);
    context.budgetGovernor.trip('BUDGET_BREACH', 'Task 6.5 deterministic budget trip');

    const denied = await call(handler, operationId, 'stasis-denied');

    expect(denied.result).toMatchObject({
      isError: true,
      _meta: { execution: { status: 'blocked', code: 'BUDGET_DENIED', replayed: true } },
    });
    expect(approval).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(context.auditSink.tail({ limit: 10 })).toHaveLength(2);
    expect(context.budgetLedger.lookup(operationId)?.state).toBe('DENIED');
    expect(context.budgetGovernor.state().stasis_active).toBe(true);
  });

  it('never redispatches an ambiguous operation and leaves unrelated state untouched', async () => {
    const { context, handler } = setup();
    const operationId = '00000000-0000-4000-8000-000000000653';
    const dispatch = vi.fn(async () => {
      throw new Error('connection ended after dispatch');
    });
    context.toolExecutor.register('set_flag', dispatch);

    const first = await call(handler, operationId, 'ambiguous-first');
    const replay = await call(handler, operationId, 'ambiguous-replay');

    expect(first.result).toMatchObject({
      isError: true,
      _meta: { execution: { status: 'error', code: 'OPERATION_IN_DOUBT', replayed: false } },
    });
    expect(replay.result).toMatchObject({
      isError: true,
      _meta: { execution: { status: 'blocked', code: 'OPERATION_IN_DOUBT', replayed: false } },
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(context.auditSink.tail({ limit: 10 })).toHaveLength(2);
    expect(context.budgetLedger.lookup(operationId)?.state).toBe('IN_DOUBT');
    expect(context.flags.get('opensky.enabled')).toBe(true);
  });
});
