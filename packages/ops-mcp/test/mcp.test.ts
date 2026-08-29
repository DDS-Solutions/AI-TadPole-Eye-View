import { PassThrough } from 'node:stream';
import { GevEvents, type OperatorToolName } from '@gev/contracts';
import { describe, expect, it } from 'vitest';
import {
  GevMcpServer,
  MCP_OPERATOR_TOOL_NAMES,
  createOperatorContext,
  executeOperatorTool,
} from '../src/index.js';

const UNAVAILABLE_CONSOLE_CALLS: Array<[OperatorToolName, Record<string, unknown>]> = [
  ['fly_to_location', { lat: 0, lon: 0 }],
  ['toggle_layer', { layer: 'flights', enabled: true }],
  ['select_entity', { layer: 'flights', id: 'fake' }],
  ['inspect_telemetry', { layer: 'flights', id: 'fake' }],
  ['query_aoi', { south: -1, west: -1, north: 1, east: 1 }],
  ['set_sim_time', { offset_s: 0 }],
];

describe('GEV v2 Operator MCP Server (@gev/ops-mcp)', () => {
  it('handles MCP initialize handshake', async () => {
    const server = new GevMcpServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client', version: '1.0' },
      },
    });

    expect(res?.id).toBe(1);
    expect(res?.result).toBeDefined();
    const result = res?.result as { serverInfo: { name: string; version: string } };
    expect(result.serverInfo.name).toBe('@gev/ops-mcp');
  });

  it('lists operator tools with governance flags', async () => {
    const server = new GevMcpServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    expect(res?.id).toBe(2);
    const result = res?.result as {
      tools: Array<{ name: string; _metadata: Record<string, unknown> }>;
    };
    const names = result.tools.map((tool) => tool.name);
    expect(names).toEqual(MCP_OPERATOR_TOOL_NAMES);
    for (const [unavailableName] of UNAVAILABLE_CONSOLE_CALLS) {
      expect(names).not.toContain(unavailableName);
    }

    const feedHealthTool = result.tools.find((t) => t.name === 'get_feed_health');
    expect(feedHealthTool?._metadata.is_mutating).toBe(false);
    expect(feedHealthTool?._metadata.is_cacheable).toBe(true);

    const setFlagTool = result.tools.find((t) => t.name === 'set_flag') as {
      name: string;
      inputSchema: { properties: Record<string, unknown>; required?: string[] };
      _metadata: Record<string, unknown>;
    };
    expect(setFlagTool?._metadata.is_mutating).toBe(true);
    expect(setFlagTool?._metadata.is_dangerous).toBe(true);
    expect(setFlagTool?._metadata.requires_reservation).toBe(true);
    expect(setFlagTool?.inputSchema.properties.flag).toBeDefined();
    expect(setFlagTool?.inputSchema.required).toContain('flag');
  });

  it.each(UNAVAILABLE_CONSOLE_CALLS)(
    'fails closed when unadvertised console-only tool %s is called directly',
    async (toolName, args) => {
      const ctx = createOperatorContext();
      const server = new GevMcpServer({ context: ctx });
      const res = await server.handleRequest({
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      });

      expect(res?.error).toMatchObject({
        code: -32601,
        message: expect.stringContaining('unavailable'),
      });
      const directResult = await executeOperatorTool(ctx, toolName, args);
      expect(directResult).toMatchObject({
        success: false,
        code: 'TOOL_UNAVAILABLE',
      });
      expect(ctx.auditSink.tail({ limit: 10 })).toEqual([]);
    }
  );

  it('executes get_feed_health and get_budget tools', async () => {
    const ctx = createOperatorContext();
    const server = new GevMcpServer({ context: ctx });

    // get_feed_health
    const healthRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_feed_health',
        arguments: {},
      },
    });

    expect(healthRes?.id).toBe(3);
    const healthContent = (healthRes?.result as { content: Array<{ text: string }> }).content[0]
      ?.text;
    const parsedHealth = JSON.parse(healthContent || '{}');
    expect((healthRes?.result as { structuredContent: unknown }).structuredContent).toEqual(
      parsedHealth
    );
    expect(parsedHealth.feeds).toHaveLength(12);
    expect(parsedHealth.feeds[0].feed).toBe('flights');
    expect(parsedHealth.feeds[0].provider).toBe('opensky');
    expect(parsedHealth.feeds[0].status).toBe('healthy');
    expect(
      parsedHealth.feeds.find((feed: { provider: string }) => feed.provider === 'celestrak')
    ).toMatchObject({ implementation: 'planned', status: 'unavailable' });

    // get_budget
    const budgetRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'get_budget',
        arguments: {},
      },
    });

    const budgetContent = (budgetRes?.result as { content: Array<{ text: string }> }).content[0]
      ?.text;
    const parsedBudget = JSON.parse(budgetContent || '{}');
    expect((budgetRes?.result as { structuredContent: unknown }).structuredContent).toEqual(
      parsedBudget
    );
    expect(parsedBudget.cap_usd).toBe(10.0);
    expect(parsedBudget.stasis_active).toBe(false);
  });

  it('executes mutating set_flag tool and records Audit WAL intent/outcome (Rule 1)', async () => {
    const ctx = createOperatorContext();
    const server = new GevMcpServer({ context: ctx });

    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'set_flag',
        arguments: {
          flag: 'opensky.enabled',
          enabled: false,
        },
      },
    });

    expect(res?.id).toBe(5);
    const content = (res?.result as { content: Array<{ text: string }> }).content[0]?.text;
    const parsed = JSON.parse(content || '{}');
    expect(parsed.flag).toBe('opensky.enabled');
    expect(parsed.enabled).toBe(false);

    // Verify Audit WAL entries
    const entries = ctx.auditSink.tail({ limit: 10 });
    expect(entries.length).toBe(2);
    const first = entries[0];
    const second = entries[1];
    expect(first?.kind).toBe(GevEvents.AuditIntent);
    if (first?.kind === GevEvents.AuditIntent) {
      expect(first.action).toBe('tool.set_flag');
    }
    expect(second?.kind).toBe(GevEvents.AuditOutcome);
    if (second?.kind === GevEvents.AuditOutcome) {
      expect(second.status).toBe('ok');
    }
  });

  it('normalizes invalid input before action and emits no audit entries', async () => {
    const ctx = createOperatorContext();
    const server = new GevMcpServer({ context: ctx });

    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'set_flag',
        arguments: { flag: 'opensky.enabled', enabled: 'not-a-boolean' },
      },
    });

    expect(res?.result).toMatchObject({
      isError: true,
      _meta: { execution: { status: 'error', code: 'INPUT_VALIDATION_FAILED' } },
    });
    expect(ctx.auditSink.tail({ limit: 10 })).toEqual([]);
  });

  it('accepts a retained MCP operation ID and replays without a second mutation or audit pair', async () => {
    const ctx = createOperatorContext();
    const server = new GevMcpServer({ context: ctx });
    const operationId = '00000000-0000-4000-8000-000000000123';
    const call = () =>
      server.handleRequest({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'set_flag',
          arguments: { flag: 'opensky.enabled', enabled: false },
          _meta: { operation_id: operationId },
        },
      });

    const first = await call();
    const replay = await call();
    expect(first?.result).toMatchObject({
      _meta: { execution: { intent_id: operationId, replayed: false } },
    });
    expect(replay?.result).toMatchObject({
      _meta: { execution: { intent_id: operationId, replayed: true } },
    });
    expect(ctx.auditSink.tail({ limit: 10 })).toHaveLength(2);
    expect(ctx.budgetLedger.lookup(operationId)?.state).toBe('SETTLED');
  });

  it('runs diagnostics check across governance, feeds, and memory', async () => {
    const ctx = createOperatorContext();
    const server = new GevMcpServer({ context: ctx });

    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'run_diagnostics',
        arguments: { scope: 'all' },
      },
    });

    const content = (res?.result as { content: Array<{ text: string }> }).content[0]?.text;
    const diag = JSON.parse(content || '{}');
    expect(diag.checks.length).toBeGreaterThanOrEqual(3);
    expect(diag.checks.some((c: { name: string }) => c.name === 'governance_stasis')).toBe(true);
  });

  it('handles stdio stream transport with JSON-RPC lines', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const server = new GevMcpServer({ input, output });

    server.start();

    const responseLine = new Promise<string>((resolve) => {
      output.once('data', (chunk) => resolve(chunk.toString()));
    });

    // Write a JSON-RPC request line
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'ping' })}\n`);

    const parsed = JSON.parse((await responseLine).trim());
    expect(parsed.id).toBe(10);
    expect(parsed.result).toEqual({});
  });
});
