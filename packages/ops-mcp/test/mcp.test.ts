import { PassThrough } from 'node:stream';
import { GevEvents } from '@gev/contracts';
import { describe, expect, it } from 'vitest';
import { GevMcpServer, createOperatorContext } from '../src/index.js';

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
      tools: Array<{ name: string; _metadata: Record<string, boolean> }>;
    };
    expect(result.tools.length).toBeGreaterThanOrEqual(6);

    const feedHealthTool = result.tools.find((t) => t.name === 'get_feed_health');
    expect(feedHealthTool?._metadata.is_mutating).toBe(false);
    expect(feedHealthTool?._metadata.is_cacheable).toBe(true);

    const setFlagTool = result.tools.find((t) => t.name === 'set_flag') as {
      name: string;
      inputSchema: { properties: Record<string, unknown>; required?: string[] };
      _metadata: Record<string, boolean>;
    };
    expect(setFlagTool?._metadata.is_mutating).toBe(true);
    expect(setFlagTool?._metadata.is_dangerous).toBe(true);
    expect(setFlagTool?.inputSchema.properties.flag).toBeDefined();
    expect(setFlagTool?.inputSchema.required).toContain('flag');
  });

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
    expect(parsedHealth.feeds[0].provider).toBe('opensky');
    expect(parsedHealth.feeds[0].status).toBe('healthy');

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
      expect(first.action).toBe('ops.set_flag');
    }
    expect(second?.kind).toBe(GevEvents.AuditOutcome);
    if (second?.kind === GevEvents.AuditOutcome) {
      expect(second.status).toBe('ok');
    }
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

    const outputData: string[] = [];
    output.on('data', (chunk) => {
      outputData.push(chunk.toString());
    });

    // Write a JSON-RPC request line
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'ping' })}\n`);

    await new Promise((r) => setTimeout(r, 50));

    expect(outputData.length).toBeGreaterThan(0);
    const parsed = JSON.parse(outputData[0]?.trim() || '{}');
    expect(parsed.id).toBe(10);
    expect(parsed.result).toEqual({});
  });
});
