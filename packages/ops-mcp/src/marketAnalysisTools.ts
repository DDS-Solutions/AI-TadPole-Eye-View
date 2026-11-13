import type {
  AnalyzeCompetitionInput,
  AnalyzeCompetitionOutput,
  AnalyzeMarketContextInput,
  AnalyzeMarketContextOutput,
  BoundingBox,
  CompareLocationsInput,
  CompareLocationsOutput,
  EconomicEvidenceRecord,
  EconomicGeography,
} from '@gev/contracts';
import type { SimClock, ToolExecutionContext } from '@gev/core';
import { analyzeCompetition, analyzeMarketContext, compareLocations } from '@gev/economic';
import { EconomicFixtureAdapter, OsmCommercialAdapter } from '@gev/providers';
import type { OperatorContext } from './context.js';
import { assertEconomicToolAllowed, sanitizeEconomicText } from './economicToolGovernance.js';

const AUSTIN_SEED_OSM_BBOX: BoundingBox = {
  min_lat: 30.25,
  min_lon: -97.76,
  max_lat: 30.28,
  max_lon: -97.73,
};

function resolveSupportedOsmBbox(geo: EconomicGeography): BoundingBox | undefined {
  if (geo.level === 'bounding_box') {
    return {
      min_lat: geo.min_lat,
      min_lon: geo.min_lon,
      max_lat: geo.max_lat,
      max_lon: geo.max_lon,
      ...(geo.name !== undefined ? { name: geo.name } : {}),
    };
  }
  if (geo.level === 'point') {
    return {
      min_lat: Math.max(-90, geo.latitude - 0.02),
      max_lat: Math.min(90, geo.latitude + 0.02),
      min_lon: Math.max(-180, geo.longitude - 0.02),
      max_lon: Math.min(180, geo.longitude + 0.02),
    };
  }
  if (
    (geo.level === 'county' && geo.county_fips === '48453') ||
    (geo.level === 'place' &&
      (geo.place_fips === '4805000' || geo.name?.toLowerCase().includes('austin'))) ||
    (geo.level === 'zcta' && geo.zcta.startsWith('787'))
  ) {
    return AUSTIN_SEED_OSM_BBOX;
  }
  return undefined;
}

export async function resolveAndAnalyzeMarketContext(options: {
  clock: SimClock;
  input: AnalyzeMarketContextInput;
  tenantId: string;
  fixtureAdapter?: EconomicFixtureAdapter;
  osmAdapter?: OsmCommercialAdapter;
  osmEnabled?: boolean;
  auditCtx?: Pick<OperatorContext, 'auditSink' | 'clock'>;
}): Promise<AnalyzeMarketContextOutput> {
  const { clock, tenantId, auditCtx } = options;
  const adapter = options.fixtureAdapter ?? new EconomicFixtureAdapter({ clock });
  const input: AnalyzeMarketContextInput = {
    ...options.input,
    tenant_id: tenantId,
    ...(options.input.industry_title !== undefined
      ? {
          industry_title: sanitizeEconomicText(
            options.input.industry_title,
            'industry_title',
            tenantId,
            auditCtx
          ),
        }
      : {}),
    ...(options.input.target_geography.name
      ? {
          target_geography: {
            ...options.input.target_geography,
            name: sanitizeEconomicText(
              options.input.target_geography.name,
              'geography_name',
              tenantId,
              auditCtx
            ),
          },
        }
      : {}),
  };

  if (input.acs_evidence.length === 0) {
    const acsRecords = adapter.getEvidenceRecords({ geography: input.target_geography });
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
    const osmRecords = adapter.getEvidenceRecords({ geography: input.target_geography });
    input.osm_evidence = osmRecords.filter(
      (r) => r.source_id === 'osm-commercial'
    ) as EconomicEvidenceRecord[];
  }

  if (!input.osm_footprint && options.osmEnabled !== false) {
    const osmBbox = resolveSupportedOsmBbox(input.target_geography);
    if (osmBbox) {
      const osmAdapter = options.osmAdapter ?? new OsmCommercialAdapter({ clock });
      const enrichment = await osmAdapter.queryCommercialEnrichment({
        bbox: osmBbox,
      });
      input.osm_footprint = enrichment.summary;
      if ((!input.osm_evidence || input.osm_evidence.length === 0) && enrichment.evidence_records) {
        input.osm_evidence = [...enrichment.evidence_records];
      }
    }
  }

  const nowIso = new Date(clock.now()).toISOString();
  return analyzeMarketContext(input, nowIso);
}

export async function handleAnalyzeMarketContext(
  ctx: OperatorContext,
  rawInput: AnalyzeMarketContextInput,
  executionContext: ToolExecutionContext = {}
): Promise<AnalyzeMarketContextOutput> {
  const tenantId = assertEconomicToolAllowed(
    ctx,
    executionContext,
    'economic market analysis tool'
  );
  return resolveAndAnalyzeMarketContext({
    clock: ctx.clock,
    input: rawInput,
    tenantId,
    osmEnabled: ctx.flags.get('osm.enabled') !== false,
    auditCtx: ctx,
  });
}

export function resolveAndAnalyzeCompetition(options: {
  clock: SimClock;
  input: AnalyzeCompetitionInput;
  tenantId: string;
  fixtureAdapter?: EconomicFixtureAdapter;
  auditCtx?: Pick<OperatorContext, 'auditSink' | 'clock'>;
}): AnalyzeCompetitionOutput {
  const { clock, tenantId, auditCtx } = options;
  const adapter = options.fixtureAdapter ?? new EconomicFixtureAdapter({ clock });
  const input: AnalyzeCompetitionInput = {
    ...options.input,
    tenant_id: tenantId,
    industry_title: sanitizeEconomicText(
      options.input.industry_title,
      'industry_title',
      tenantId,
      auditCtx
    ),
    osm_poi_features: options.input.osm_poi_features.map((f, idx) => ({
      ...f,
      name: sanitizeEconomicText(f.name, `osm_poi_${idx}`, tenantId, auditCtx),
    })),
  };

  if (input.cbp_evidence.length === 0) {
    const cbpRecords = adapter.getEvidenceRecords({
      geography: input.target_geography,
      naicsCode: input.naics_code,
    });
    input.cbp_evidence = cbpRecords.filter(
      (r) => r.source_id === 'census-cbp-zbp'
    ) as EconomicEvidenceRecord[];
  }

  const nowIso = new Date(clock.now()).toISOString();
  return analyzeCompetition(input, nowIso);
}

export async function handleAnalyzeCompetition(
  ctx: OperatorContext,
  rawInput: AnalyzeCompetitionInput,
  executionContext: ToolExecutionContext = {}
): Promise<AnalyzeCompetitionOutput> {
  const tenantId = assertEconomicToolAllowed(
    ctx,
    executionContext,
    'economic competition analysis tool'
  );
  return resolveAndAnalyzeCompetition({
    clock: ctx.clock,
    input: rawInput,
    tenantId,
    auditCtx: ctx,
  });
}

export function resolveAndCompareLocations(options: {
  clock: SimClock;
  input: CompareLocationsInput;
  tenantId: string;
  fixtureAdapter?: EconomicFixtureAdapter;
  auditCtx?: Pick<OperatorContext, 'auditSink' | 'clock'>;
}): CompareLocationsOutput {
  const { clock, tenantId, auditCtx } = options;
  const adapter = options.fixtureAdapter ?? new EconomicFixtureAdapter({ clock });
  const input: CompareLocationsInput = {
    ...options.input,
    tenant_id: tenantId,
    ...(options.input.industry_title !== undefined
      ? {
          industry_title: sanitizeEconomicText(
            options.input.industry_title,
            'industry_title',
            tenantId,
            auditCtx
          ),
        }
      : {}),
    locations: options.input.locations.map((loc, idx) => {
      let acs = loc.acs_evidence;
      let cbp = loc.cbp_evidence;
      if (acs.length === 0) {
        acs = adapter
          .getEvidenceRecords({ geography: loc.geography })
          .filter((r) => r.source_id === 'census-acs') as EconomicEvidenceRecord[];
      }
      if (cbp.length === 0) {
        cbp = adapter
          .getEvidenceRecords({ geography: loc.geography, naicsCode: options.input.naics_code })
          .filter((r) => r.source_id === 'census-cbp-zbp') as EconomicEvidenceRecord[];
      }
      return {
        ...loc,
        label: sanitizeEconomicText(loc.label, `location_label_${idx}`, tenantId, auditCtx),
        acs_evidence: acs,
        cbp_evidence: cbp,
      };
    }),
  };

  const nowIso = new Date(clock.now()).toISOString();
  return compareLocations(input, nowIso);
}

export async function handleCompareLocations(
  ctx: OperatorContext,
  rawInput: CompareLocationsInput,
  executionContext: ToolExecutionContext = {}
): Promise<CompareLocationsOutput> {
  const tenantId = assertEconomicToolAllowed(
    ctx,
    executionContext,
    'economic location comparison tool'
  );
  return resolveAndCompareLocations({
    clock: ctx.clock,
    input: rawInput,
    tenantId,
    auditCtx: ctx,
  });
}
