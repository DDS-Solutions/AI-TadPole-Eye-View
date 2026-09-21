import {
  AnalyzeCompetitionOutputSchema,
  AnalyzeMarketContextOutputSchema,
  CompareLocationsOutputSchema,
  ECONOMIC_LEGAL_DISCLAIMER,
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

const sampleMarketInput = {
  target_geography: {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  },
  naics_code: '722511',
  industry_title: 'Full-Service Restaurants',
  acs_evidence: [],
  cbp_evidence: [],
};

const sampleCompetitionInput = {
  target_geography: {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  },
  naics_code: '722511',
  industry_title: 'Full-Service Restaurants',
  cbp_evidence: [],
  osm_poi_features: [],
};

const sampleLocationComparisonInput = {
  locations: [
    {
      location_key: 'travis-county',
      label: 'Travis County, TX',
      geography: {
        level: 'county' as const,
        county_fips: '48453',
        state_fips: '48',
        name: 'Travis County, TX',
      },
      acs_evidence: [],
      cbp_evidence: [],
    },
    {
      location_key: 'austin-city',
      label: 'Austin City, TX',
      geography: {
        level: 'place' as const,
        place_fips: '4805000',
        name: 'Austin city, TX',
      },
      acs_evidence: [],
      cbp_evidence: [],
    },
  ],
  benchmark_location_key: 'travis-county',
  naics_code: '722511',
  industry_title: 'Full-Service Restaurants',
};

describe('Market Analysis MCP Operator Tools (Task 9.5)', () => {
  it('executes analyze_market_context through GovernedToolExecutor with audit logging', async () => {
    const context = createContext();

    const execution = await executeOperatorTool(
      context,
      'analyze_market_context',
      sampleMarketInput,
      {
        tenant_id: 'tenant-beta',
        task_ref: 'task-9.5-mcp-market',
      }
    );

    expect(execution.success).toBe(true);
    expect(execution.status).toBe('ok');

    const result = AnalyzeMarketContextOutputSchema.parse(execution.result);
    expect(result.schema_version).toBe(1);
    expect(result.tenant_id).toBe('tenant-beta');
    expect(result.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
    expect(result.evidence_bundle.records.length).toBeGreaterThan(0);
    expect(result.demographics.total_population.status).toBe('available');
    expect(result.business_activity.total_establishments.status).toBe('available');

    const logs = context.auditSink.tail();
    expect(
      logs.some((l) => l.kind === 'audit.intent' && l.action === 'tool.analyze_market_context')
    ).toBe(true);
  });

  it('executes analyze_competition through GovernedToolExecutor with HHI output', async () => {
    const context = createContext();

    const execution = await executeOperatorTool(
      context,
      'analyze_competition',
      sampleCompetitionInput,
      {
        tenant_id: 'tenant-beta',
        task_ref: 'task-9.5-mcp-comp',
      }
    );

    expect(execution.success).toBe(true);
    expect(execution.status).toBe('ok');

    const result = AnalyzeCompetitionOutputSchema.parse(execution.result);
    expect(result.schema_version).toBe(1);
    expect(result.tenant_id).toBe('tenant-beta');
    expect(result.concentration.tier).toBeDefined();
    expect(result.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);

    const logs = context.auditSink.tail();
    expect(
      logs.some((l) => l.kind === 'audit.intent' && l.action === 'tool.analyze_competition')
    ).toBe(true);
  });

  it('executes compare_locations through GovernedToolExecutor with multi-location ranking', async () => {
    const context = createContext();

    const execution = await executeOperatorTool(
      context,
      'compare_locations',
      sampleLocationComparisonInput,
      {
        tenant_id: 'tenant-beta',
        task_ref: 'task-9.5-mcp-compare',
      }
    );

    expect(execution.success).toBe(true);
    expect(execution.status).toBe('ok');

    const result = CompareLocationsOutputSchema.parse(execution.result);
    expect(result.schema_version).toBe(1);
    expect(result.tenant_id).toBe('tenant-beta');
    expect(result.locations.length).toBe(2);
    expect(result.metrics.length).toBeGreaterThan(0);
    expect(result.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);

    const logs = context.auditSink.tail();
    expect(
      logs.some((l) => l.kind === 'audit.intent' && l.action === 'tool.compare_locations')
    ).toBe(true);
  });

  it('fails closed when global STASIS is entered', async () => {
    const context = createContext();
    context.budgetGovernor.trip('BUDGET_BREACH', 'Budget cap exceeded');

    const execution = await executeOperatorTool(
      context,
      'analyze_market_context',
      sampleMarketInput
    );

    expect(execution.success).toBe(false);
    expect(execution.status).toBe('error');
    expect(execution.error).toContain('STASIS');
  });

  it('fails closed when economic engine is disabled by kill-switch flag', async () => {
    const context = createContext();
    context.flags.set('economic.enabled', false);

    const execution = await executeOperatorTool(
      context,
      'analyze_market_context',
      sampleMarketInput
    );

    expect(execution.success).toBe(false);
    expect(execution.status).toBe('error');
    expect(execution.error).toContain('disabled by kill-switch policy');
  });
});
