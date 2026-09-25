import {
  AnalyzeWorkforceContextOutputSchema,
  ECONOMIC_LEGAL_DISCLAIMER,
  WORKFORCE_LABOR_MARKET_SIGNAL_DISCLAIMER,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
import { type OperatorContext, createOperatorContext, executeOperatorTool } from '../src/index.js';

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

const sampleWorkforceInput = {
  target_geography: {
    level: 'cbsa' as const,
    cbsa_code: '12420',
    name: 'Austin-Round Rock-Georgetown, TX',
  },
  soc_code: '15-1252',
  occupation_title: 'Software Developers',
  oews_evidence: [],
  lau_evidence: [],
};

describe('Workforce Analysis MCP Operator Tools (Task 10.2 & ADR 0061)', () => {
  it('executes analyze_workforce_context through GovernedToolExecutor with audit logging', async () => {
    const context = createContext();

    const execution = await executeOperatorTool(
      context,
      'analyze_workforce_context',
      sampleWorkforceInput,
      {
        tenant_id: 'tenant-beta',
        task_ref: 'task-10.2-mcp-workforce',
      }
    );

    expect(execution.success).toBe(true);
    expect(execution.status).toBe('ok');

    const result = AnalyzeWorkforceContextOutputSchema.parse(execution.result);
    expect(result.tenant_id).toBe('tenant-beta');
    expect(result.soc_code).toBe('15-1252');
    expect(result.signal_type).toBe('aggregate_labor_market_survey_signal');
    expect(result.disclaimer).toBe(WORKFORCE_LABOR_MARKET_SIGNAL_DISCLAIMER);
    expect(result.legal_disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
    expect(result.wage_differentials).toBeDefined();
    expect(result.unemployment_dynamics).toBeDefined();

    // Verify audit intent and outcome were recorded
    const entries = context.auditSink.tail({ limit: 10 });
    expect(entries.some((e) => e.kind === 'audit.intent')).toBe(true);
    expect(entries.some((e) => e.kind === 'audit.outcome')).toBe(true);
  });

  it('fails closed when STASIS is active', async () => {
    const context = createContext();
    context.budgetGovernor.trip('BUDGET_BREACH', 'Test budget breach');

    const execution = await executeOperatorTool(
      context,
      'analyze_workforce_context',
      sampleWorkforceInput,
      {
        tenant_id: 'tenant-beta',
        task_ref: 'task-10.2-stasis',
      }
    );

    expect(execution.success).toBe(false);
    expect(execution.status).toBe('error');
    expect(execution.error).toContain('STASIS');
  });

  it('fails closed when economic engine is disabled by kill switch', async () => {
    const context = createContext();
    context.flags.set('economic.enabled', false);

    const execution = await executeOperatorTool(
      context,
      'analyze_workforce_context',
      sampleWorkforceInput,
      {
        tenant_id: 'tenant-beta',
        task_ref: 'task-10.2-killswitch',
      }
    );

    expect(execution.success).toBe(false);
    expect(execution.status).toBe('error');
    expect(execution.error).toContain('disabled by kill-switch');
  });
});
