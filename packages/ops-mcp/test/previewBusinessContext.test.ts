import { ECONOMIC_LEGAL_DISCLAIMER, PreviewBusinessContextOutputSchema } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GevMcpServer,
  type OperatorContext,
  createOperatorContext,
  executeOperatorTool,
} from '../src/index.js';

const contexts: OperatorContext[] = [];

function createContext(): OperatorContext {
  const context = createOperatorContext({
    clock: new FrozenClock(1_773_700_000_000),
  });
  contexts.push(context);
  return context;
}

afterEach(() => {
  while (contexts.length > 0) {
    contexts.pop()?.governanceContext.close();
  }
});

const sampleInput = {
  business_name: 'Apex AI Systems',
  naics_code: '541511',
  industry_title: 'Custom Computer Programming Services',
  target_geography: {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  },
  operating_radius_meters: 25000,
  employee_count_estimate: 45,
  annual_revenue_usd_estimate: 5000000,
};

describe('preview_business_context MCP Operator Tool (Task 8.4)', () => {
  it('executes statelessly through GovernedToolExecutor and returns compliant preview', async () => {
    const context = createContext();

    const execution = await executeOperatorTool(context, 'preview_business_context', sampleInput, {
      tenant_id: 'tenant-alpha',
    });

    expect(execution.success).toBe(true);
    expect(execution.status).toBe('ok');

    const result = PreviewBusinessContextOutputSchema.parse(execution.result);
    expect(result.schema_version).toBe(1);
    expect(result.tenant_id).toBe('tenant-alpha');
    expect(result.input.business_name).toBe('Apex AI Systems');
    expect(result.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
    expect(result.provenance.mode).toBe('seed');

    // Evidence and summary estimates
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.summary_estimates.median_household_income.status).toBe('available');
    expect(result.summary_estimates.total_establishments.status).toBe('available');
    expect(result.summary_estimates.industry_location_quotient.status).toBe('available');
    expect(result.summary_estimates.market_concentration_hhi.status).toBe('available');

    // Verify audit intent and outcome were recorded
    const logs = context.auditSink.tail({ limit: 10 });
    const intent = logs.find(
      (l) => l.kind === 'audit.intent' && l.action === 'tool.preview_business_context'
    );
    expect(intent).toBeDefined();
    const outcome = logs.find((l) => l.kind === 'audit.outcome' && l.intent_id === intent?.id);
    expect(outcome).toBeDefined();
    expect(outcome?.status).toBe('ok');
  });

  it('preserves suppressed metrics without coercing to zero', async () => {
    const context = createContext();

    const execution = await executeOperatorTool(context, 'preview_business_context', sampleInput, {
      tenant_id: 'tenant-suppression-test',
    });

    expect(execution.success).toBe(true);
    const result = PreviewBusinessContextOutputSchema.parse(execution.result);

    // Evidence should retain small-sample and statutory disclosure avoidance
    const suppressedRecords = result.evidence.filter((r) => r.estimate.status === 'suppressed');
    expect(suppressedRecords.length).toBeGreaterThan(0);
    for (const record of suppressedRecords) {
      expect(record.estimate.status).toBe('suppressed');
      if (record.estimate.status === 'suppressed') {
        expect(record.estimate.reason).toBeDefined();
        // Crucial invariant: never coerced to zero
        expect('value' in record.estimate).toBe(false);
      }
    }
  });

  it('fails closed when economic engine is disabled by kill-switch flag', async () => {
    const context = createContext();
    context.flags.set('economic.enabled', false);

    const execution = await executeOperatorTool(context, 'preview_business_context', sampleInput);

    expect(execution.success).toBe(false);
    expect(execution.status).toBe('error');
    expect(execution.error).toContain('kill-switch');

    // Outcome was logged as error
    const logs = context.auditSink.tail({ limit: 10 });
    const intent = logs.find(
      (l) => l.kind === 'audit.intent' && l.action === 'tool.preview_business_context'
    );
    const outcome = logs.find((l) => l.kind === 'audit.outcome' && l.intent_id === intent?.id);
    expect(outcome?.status).toBe('error');
  });

  it('fails closed when STASIS is active', async () => {
    const context = createContext();
    context.budgetGovernor.trip('BUDGET_BREACH', 'Test budget limit breach');

    const execution = await executeOperatorTool(context, 'preview_business_context', sampleInput);

    expect(execution.success).toBe(false);
    expect(execution.status).toBe('error');
    expect(execution.error).toContain('STASIS');
  });

  it('executes correctly via stdio MCP JSON-RPC protocol', async () => {
    const context = createContext();
    const server = new GevMcpServer({ context });

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 'mcp-req-1',
      method: 'tools/call',
      params: {
        name: 'preview_business_context',
        arguments: sampleInput,
      },
    });

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 'mcp-req-1',
    });
    expect(response && 'result' in response).toBe(true);
    const mcpResult = (response as { result: { structuredContent: unknown; isError?: boolean } })
      .result;
    expect(mcpResult.isError).toBeUndefined();
    const parsed = PreviewBusinessContextOutputSchema.parse(mcpResult.structuredContent);
    expect(parsed.input.business_name).toBe('Apex AI Systems');
    expect(parsed.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
  });
});
