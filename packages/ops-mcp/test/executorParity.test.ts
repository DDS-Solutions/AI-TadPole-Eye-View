import type { ApprovalGate } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GevMcpServer,
  MCP_OPERATOR_TOOL_NAMES,
  type OperatorContext,
  createOperatorContext,
  executeOperatorTool,
} from '../src/index.js';

const contexts: OperatorContext[] = [];

function createContext(approvalGate?: ApprovalGate): OperatorContext {
  const context = createOperatorContext({
    clock: new FrozenClock(1_700_000_000_000),
    ...(approvalGate ? { approvalGate } : {}),
  });
  contexts.push(context);
  return context;
}

afterEach(() => {
  while (contexts.length > 0) {
    contexts.pop()?.governanceContext.close();
  }
});

describe('operator consumer parity through the shared executor', () => {
  it('registers exactly the seven stdio capabilities on the context-owned executor', () => {
    const context = createContext();

    expect(MCP_OPERATOR_TOOL_NAMES).toHaveLength(7);
    for (const name of MCP_OPERATOR_TOOL_NAMES) {
      expect(context.toolExecutor.hasHandler(name)).toBe(true);
    }
    expect(context.toolExecutor.hasHandler('fly_to_location')).toBe(false);
  });

  it('uses one handler dispatch and one intent/outcome pair for direct and stdio success', async () => {
    const context = createContext();
    const server = new GevMcpServer({ context });

    const direct = await executeOperatorTool(context, 'set_flag', {
      flag: 'opensky.enabled',
      enabled: false,
    });
    expect(direct).toMatchObject({
      success: true,
      status: 'ok',
      result: { flag: 'opensky.enabled', enabled: false, updated: true },
    });
    expect(context.flags.get('opensky.enabled')).toBe(false);

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'set_flag',
        arguments: { flag: 'opensky.enabled', enabled: true },
      },
    });
    expect(response?.result).toMatchObject({
      structuredContent: { flag: 'opensky.enabled', enabled: true, updated: true },
      _meta: { execution: { status: direct.status } },
    });
    expect(context.flags.get('opensky.enabled')).toBe(true);

    const entries = context.auditSink.tail({ limit: 10 });
    expect(entries.map((entry) => entry.kind)).toEqual([
      'audit.intent',
      'audit.outcome',
      'audit.intent',
      'audit.outcome',
    ]);
  });

  it('preserves the same normalized blocked semantics and prevents action after denial', async () => {
    const denyingGate: ApprovalGate = {
      request: async (request) => ({
        request_id: request.id,
        decision: 'denied',
        decided_by: 'human',
        decided_at: request.ts,
      }),
    };
    const context = createContext(denyingGate);
    const server = new GevMcpServer({ context });

    const direct = await executeOperatorTool(context, 'set_flag', {
      flag: 'opensky.enabled',
      enabled: false,
    });
    expect(direct).toMatchObject({
      success: false,
      status: 'blocked',
      blocked: true,
      code: 'APPROVAL_DENIED',
    });
    expect(context.flags.get('opensky.enabled')).toBe(true);

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'set_flag',
        arguments: { flag: 'opensky.enabled', enabled: false },
      },
    });
    expect(response?.result).toMatchObject({
      isError: true,
      _meta: {
        execution: {
          status: direct.status,
          code: direct.code,
        },
      },
    });
    expect(context.flags.get('opensky.enabled')).toBe(true);

    const entries = context.auditSink.tail({ limit: 10 });
    expect(entries.map((entry) => entry.kind)).toEqual([
      'audit.intent',
      'audit.outcome',
      'audit.intent',
      'audit.outcome',
    ]);
    expect(entries.filter((entry) => entry.kind === 'audit.outcome')).toEqual([
      expect.objectContaining({ status: 'blocked' }),
      expect.objectContaining({ status: 'blocked' }),
    ]);
  });

  it('preserves approval-verification error semantics across direct and stdio calls', async () => {
    const unavailableGate: ApprovalGate = {
      request: async () => {
        throw new Error('signed approval verification failed');
      },
    };
    const context = createContext(unavailableGate);
    const server = new GevMcpServer({ context });

    const direct = await executeOperatorTool(context, 'set_flag', {
      flag: 'opensky.enabled',
      enabled: false,
    });
    expect(direct).toMatchObject({
      success: false,
      status: 'error',
      code: 'APPROVAL_UNAVAILABLE',
    });

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'set_flag',
        arguments: { flag: 'opensky.enabled', enabled: false },
      },
    });
    expect(response?.result).toMatchObject({
      isError: true,
      _meta: { execution: { status: direct.status, code: direct.code } },
    });
    expect(context.flags.get('opensky.enabled')).toBe(true);

    const outcomes = context.auditSink
      .tail({ limit: 10 })
      .filter((entry) => entry.kind === 'audit.outcome');
    expect(outcomes).toEqual([
      expect.objectContaining({ status: 'error' }),
      expect.objectContaining({ status: 'error' }),
    ]);
  });
});
