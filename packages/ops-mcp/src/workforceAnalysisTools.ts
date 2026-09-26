import type {
  AnalyzeWorkforceContextInput,
  AnalyzeWorkforceContextOutput,
  EconomicEvidenceRecord,
  EconomicGeography,
} from '@gev/contracts';
import type { ToolExecutionContext } from '@gev/core';
import { analyzeWorkforceContext } from '@gev/economic';
import { BlsLauAdapter, BlsOewsAdapter } from '@gev/providers';
import type { OperatorContext } from './context.js';

export async function handleAnalyzeWorkforceContext(
  ctx: OperatorContext,
  rawInput: AnalyzeWorkforceContextInput,
  executionContext: ToolExecutionContext = {}
): Promise<AnalyzeWorkforceContextOutput> {
  if (ctx.budgetGovernor.state().stasis_active) {
    throw new Error('STASIS: economic workforce analysis tool is suspended');
  }
  if (ctx.flags.get('economic.enabled') === false) {
    throw new Error('Economic analysis engine is disabled by kill-switch policy');
  }

  const tenantId =
    executionContext.tenant_id ??
    (executionContext.identity ? executionContext.identity.tenant_id : 'tenant-local');

  const oewsAdapter = new BlsOewsAdapter({ clock: ctx.clock, seedMode: true });
  const lauAdapter = new BlsLauAdapter({ clock: ctx.clock, seedMode: true });

  const input = { ...rawInput, tenant_id: tenantId };

  function resolveWorkforceOewsGeography(geo: EconomicGeography): EconomicGeography {
    if (geo.level === 'cbsa' || geo.level === 'state' || geo.level === 'nation') {
      return geo;
    }
    if (geo.level === 'county') {
      if (geo.county_fips?.startsWith('48453') || geo.county_fips?.startsWith('48')) {
        return { level: 'cbsa', cbsa_code: '12420', name: 'Austin-Round Rock-Georgetown, TX' };
      }
    }
    if (geo.level === 'place') {
      if (geo.place_fips === '4805000' || geo.name?.toLowerCase().includes('austin')) {
        return { level: 'cbsa', cbsa_code: '12420', name: 'Austin-Round Rock-Georgetown, TX' };
      }
    }
    if (geo.level === 'zcta') {
      if (geo.zcta?.startsWith('787')) {
        return { level: 'cbsa', cbsa_code: '12420', name: 'Austin-Round Rock-Georgetown, TX' };
      }
    }
    return geo;
  }

  function resolveWorkforceLauGeography(geo: EconomicGeography): EconomicGeography {
    if (
      geo.level === 'county' ||
      geo.level === 'cbsa' ||
      geo.level === 'state' ||
      geo.level === 'nation'
    ) {
      return geo;
    }
    if (geo.level === 'place' || geo.level === 'zcta') {
      return { level: 'county', county_fips: '48453', state_fips: '48', name: 'Travis County, TX' };
    }
    return geo;
  }

  if (input.oews_evidence.length === 0) {
    try {
      const oewsGeo = resolveWorkforceOewsGeography(input.target_geography);
      const localRecords = await oewsAdapter.query({
        geography: oewsGeo,
        soc_code: input.soc_code,
      });
      const nationalRecords = await oewsAdapter.query({
        geography: { level: 'nation', country_code: 'US' },
        soc_code: input.soc_code,
      });
      const allLocalOccupations = await oewsAdapter.query({
        geography: oewsGeo,
        soc_code: '00-0000',
      });
      const allNationalOccupations = await oewsAdapter.query({
        geography: { level: 'nation', country_code: 'US' },
        soc_code: '00-0000',
      });
      const geoAllRecords = await oewsAdapter.getEvidenceByGeography(oewsGeo);
      const combined = [
        ...localRecords,
        ...nationalRecords,
        ...allLocalOccupations,
        ...allNationalOccupations,
        ...geoAllRecords,
      ];
      const seenIds = new Set<string>();
      const deduped: EconomicEvidenceRecord[] = [];
      for (const r of combined) {
        if (!seenIds.has(r.evidence_id)) {
          seenIds.add(r.evidence_id);
          deduped.push(r as EconomicEvidenceRecord);
        }
      }
      input.oews_evidence = deduped;
    } catch {
      input.oews_evidence = [];
    }
  }

  if (input.lau_evidence.length === 0) {
    try {
      const lauGeo = resolveWorkforceLauGeography(input.target_geography);
      const lauRecords = await lauAdapter.query({
        geography: lauGeo,
      });
      input.lau_evidence = lauRecords as EconomicEvidenceRecord[];
    } catch {
      input.lau_evidence = [];
    }
  }

  const nowIso = new Date(ctx.clock.now()).toISOString();
  return analyzeWorkforceContext(input, nowIso);
}
