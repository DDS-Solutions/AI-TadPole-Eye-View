import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type GovernanceRuntimeContext, createGovernanceRuntimeContext } from '@gev/governance';
import { afterEach, describe, expect, it } from 'vitest';
import { createOperatorContext } from '../src/context.js';
import { GevMcpServer } from '../src/server.js';

const tempDirectories: string[] = [];
const runtimeContexts: GovernanceRuntimeContext[] = [];

afterEach(() => {
  for (const context of runtimeContexts.splice(0).reverse()) {
    context.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('MCP shared governance runtime wiring', () => {
  it('reports a STASIS trip written by a separate runtime through tools and transport', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-mcp-governance-'));
    tempDirectories.push(directory);
    const dbPath = path.join(directory, 'governance.sqlite');
    const writer = createGovernanceRuntimeContext({ dbPath, capUsd: 1 });
    const reader = createGovernanceRuntimeContext({ dbPath });
    runtimeContexts.push(writer, reader);
    const operatorContext = createOperatorContext({ governanceContext: reader });
    const server = new GevMcpServer({ context: operatorContext });

    expect(operatorContext.auditSink).toBe(reader.auditSink);
    expect(operatorContext.budgetGovernor).toBe(reader.budgetGovernor);
    writer.budgetGovernor.recordSpend(1);

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_budget', arguments: {} },
    });
    const content = (response?.result as { content: Array<{ text: string }> }).content[0]?.text;
    const budget = JSON.parse(content ?? '{}');
    expect(budget).toMatchObject({
      cap_usd: 1,
      spent_usd: 1,
      remaining_usd: 0,
      stasis_active: true,
      governance_authority: {
        kind: 'shared_sqlite',
        authoritative: true,
      },
    });
  });
});
