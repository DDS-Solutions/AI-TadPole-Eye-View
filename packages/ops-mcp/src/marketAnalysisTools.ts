import type {
  AnalyzeCompetitionInput,
  AnalyzeCompetitionOutput,
  AnalyzeMarketContextInput,
  AnalyzeMarketContextOutput,
  CompareLocationsInput,
  CompareLocationsOutput,
  EconomicEvidenceRecord,
} from '@gev/contracts';
import type { ToolExecutionContext } from '@gev/core';
import { analyzeCompetition, analyzeMarketContext, compareLocations } from '@gev/economic';
import { EconomicFixtureAdapter } from '@gev/providers';
import type { OperatorContext } from './context.js';

export async function handleAnalyzeMarketContext(
  ctx: OperatorContext,
  rawInput: AnalyzeMarketContextInput,
  executionContext: ToolExecutionContext = {}
): Promise<AnalyzeMarketContextOutput> {
  if (ctx.budgetGovernor.state().stasis_active) {
    throw new Error('STASIS: economic market analysis tool is suspended');
  }
  if (ctx.flags.get('economic.enabled') === false) {
    throw new Error('Economic analysis engine is disabled by kill-switch policy');
  }

  const tenantId =
    executionContext.tenant_id ??
    (executionContext.identity ? executionContext.identity.tenant_id : 'tenant-local');

  const adapter = new EconomicFixtureAdapter({ clock: ctx.clock });
  const input = { ...rawInput, tenant_id: tenantId };

  if (input.acs_evidence.length === 0) {
    const acsRecords = adapter.getEvidenceRecords({
      geography: input.target_geography,
    });
    input.acs_evidence = acsRecords.filter(
      (r) => r.source_id === 'census-acs'
    ) as EconomicEvidenceRecord[];
  }
  if (input.cbp_evidence.length === 0) {
    const cbpRecords = adapter.getEvidenceRecords({
      geography: input.target_geography,
      naicsCode: input.naics_code,
    });
    input.cbp_evidence = cbpRecords.filter(
      (r) => r.source_id === 'census-cbp-zbp'
    ) as EconomicEvidenceRecord[];
  }
  if (!input.osm_evidence || input.osm_evidence.length === 0) {
    const osmRecords = adapter.getEvidenceRecords({
      geography: input.target_geography,
    });
    input.osm_evidence = osmRecords.filter(
      (r) => r.source_id === 'osm-commercial'
    ) as EconomicEvidenceRecord[];
  }
  if (!input.osm_footprint) {
    input.osm_footprint = {
      total_features: 1540,
      category_counts: {
        food_and_beverage: 650,
        retail: 420,
        services: 230,
        office: 120,
        craft_industrial: 40,
        healthcare: 50,
        hospitality: 30,
        other_commercial: 0,
      },
      density_per_km2: 24.5,
      area_km2: 62.85,
      top_amenities: [],
    };
  }

  const nowIso = new Date(ctx.clock.now()).toISOString();
  return analyzeMarketContext(input, nowIso);
}

export async function handleAnalyzeCompetition(
  ctx: OperatorContext,
  rawInput: AnalyzeCompetitionInput,
  executionContext: ToolExecutionContext = {}
): Promise<AnalyzeCompetitionOutput> {
  if (ctx.budgetGovernor.state().stasis_active) {
    throw new Error('STASIS: economic competition analysis tool is suspended');
  }
  if (ctx.flags.get('economic.enabled') === false) {
    throw new Error('Economic analysis engine is disabled by kill-switch policy');
  }

  const tenantId =
    executionContext.tenant_id ??
    (executionContext.identity ? executionContext.identity.tenant_id : 'tenant-local');

  const adapter = new EconomicFixtureAdapter({ clock: ctx.clock });
  const input = { ...rawInput, tenant_id: tenantId };

  if (input.cbp_evidence.length === 0) {
    const cbpRecords = adapter.getEvidenceRecords({
      geography: input.target_geography,
      naicsCode: input.naics_code,
    });
    input.cbp_evidence = cbpRecords.filter(
      (r) => r.source_id === 'census-cbp-zbp'
    ) as EconomicEvidenceRecord[];
  }

  const nowIso = new Date(ctx.clock.now()).toISOString();
  return analyzeCompetition(input, nowIso);
}

export async function handleCompareLocations(
  ctx: OperatorContext,
  rawInput: CompareLocationsInput,
  executionContext: ToolExecutionContext = {}
): Promise<CompareLocationsOutput> {
  if (ctx.budgetGovernor.state().stasis_active) {
    throw new Error('STASIS: economic location comparison tool is suspended');
  }
  if (ctx.flags.get('economic.enabled') === false) {
    throw new Error('Economic analysis engine is disabled by kill-switch policy');
  }

  const tenantId =
    executionContext.tenant_id ??
    (executionContext.identity ? executionContext.identity.tenant_id : 'tenant-local');

  const adapter = new EconomicFixtureAdapter({ clock: ctx.clock });
  const input = {
    ...rawInput,
    tenant_id: tenantId,
    locations: rawInput.locations.map((loc) => {
      let acs = loc.acs_evidence;
      let cbp = loc.cbp_evidence;
      if (acs.length === 0) {
        acs = adapter
          .getEvidenceRecords({ geography: loc.geography })
          .filter((r) => r.source_id === 'census-acs') as EconomicEvidenceRecord[];
      }
      if (cbp.length === 0) {
        cbp = adapter
          .getEvidenceRecords({ geography: loc.geography, naicsCode: rawInput.naics_code })
          .filter((r) => r.source_id === 'census-cbp-zbp') as EconomicEvidenceRecord[];
      }
      return {
        ...loc,
        acs_evidence: acs,
        cbp_evidence: cbp,
      };
    }),
  };

  const nowIso = new Date(ctx.clock.now()).toISOString();
  return compareLocations(input, nowIso);
}
