import type {
  AnalyzeWorkforceContextInput,
  AnalyzeWorkforceContextOutput,
  EconomicEvidenceRecord,
  EconomicGeography,
} from '@gev/contracts';
import type { SimClock, ToolExecutionContext } from '@gev/core';
import { analyzeWorkforceContext } from '@gev/economic';
import { BlsLauAdapter, BlsOewsAdapter } from '@gev/providers';
import type { OperatorContext } from './context.js';
import { assertEconomicToolAllowed, sanitizeEconomicText } from './economicToolGovernance.js';

function resolveWorkforceOewsGeography(geo: EconomicGeography): EconomicGeography {
  if (geo.level === 'cbsa' || geo.level === 'state' || geo.level === 'nation') {
    return geo;
  }
  if (geo.level === 'county') {
    if (geo.county_fips === '48453' || geo.county_fips?.startsWith('48')) {
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
  // Map only known Austin municipal/ZCTA geographies to Travis County (never coerce arbitrary ZCTAs/places)
  if (
    (geo.level === 'place' &&
      (geo.place_fips === '4805000' || geo.name?.toLowerCase().includes('austin'))) ||
    (geo.level === 'zcta' && geo.zcta?.startsWith('787'))
  ) {
    return { level: 'county', county_fips: '48453', state_fips: '48', name: 'Travis County, TX' };
  }
  return geo;
}

function isSupportedOewsLevel(geo: EconomicGeography): boolean {
  return geo.level === 'cbsa' || geo.level === 'state' || geo.level === 'nation';
}

function isSupportedLauLevel(geo: EconomicGeography): boolean {
  return (
    geo.level === 'county' ||
    geo.level === 'cbsa' ||
    geo.level === 'state' ||
    geo.level === 'nation'
  );
}

export async function resolveAndAnalyzeWorkforceContext(options: {
  clock: SimClock;
  input: AnalyzeWorkforceContextInput;
  tenantId: string;
  oewsAdapter?: BlsOewsAdapter;
  lauAdapter?: BlsLauAdapter;
  auditCtx?: Pick<OperatorContext, 'auditSink' | 'clock'>;
}): Promise<AnalyzeWorkforceContextOutput> {
  const { clock, tenantId, auditCtx } = options;
  const oewsAdapter = options.oewsAdapter ?? new BlsOewsAdapter({ clock });
  const lauAdapter = options.lauAdapter ?? new BlsLauAdapter({ clock });

  const input: AnalyzeWorkforceContextInput = {
    ...options.input,
    tenant_id: tenantId,
    ...(options.input.occupation_title
      ? {
          occupation_title: sanitizeEconomicText(
            options.input.occupation_title,
            'occupation_title',
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

  if (input.oews_evidence.length === 0) {
    const oewsGeo = resolveWorkforceOewsGeography(input.target_geography);
    if (isSupportedOewsLevel(oewsGeo)) {
      const [localRecords, nationalRecords, allLocalOccupations, allNationalOccupations, geoAll] =
        await Promise.all([
          oewsAdapter.query({ geography: oewsGeo, soc_code: input.soc_code }),
          oewsAdapter.query({
            geography: { level: 'nation', country_code: 'US' },
            soc_code: input.soc_code,
          }),
          oewsAdapter.query({ geography: oewsGeo, soc_code: '00-0000' }),
          oewsAdapter.query({
            geography: { level: 'nation', country_code: 'US' },
            soc_code: '00-0000',
          }),
          oewsAdapter.getEvidenceByGeography(oewsGeo),
        ]);

      const combined = [
        ...localRecords,
        ...nationalRecords,
        ...allLocalOccupations,
        ...allNationalOccupations,
        ...geoAll,
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
    }
  }

  if (input.lau_evidence.length === 0) {
    const lauGeo = resolveWorkforceLauGeography(input.target_geography);
    if (isSupportedLauLevel(lauGeo)) {
      const lauRecords = await lauAdapter.query({ geography: lauGeo });
      input.lau_evidence = lauRecords as EconomicEvidenceRecord[];
    }
  }

  const nowIso = new Date(clock.now()).toISOString();
  return analyzeWorkforceContext(input, nowIso);
}

export async function handleAnalyzeWorkforceContext(
  ctx: OperatorContext,
  rawInput: AnalyzeWorkforceContextInput,
  executionContext: ToolExecutionContext = {}
): Promise<AnalyzeWorkforceContextOutput> {
  const tenantId = assertEconomicToolAllowed(
    ctx,
    executionContext,
    'economic workforce analysis tool'
  );
  return resolveAndAnalyzeWorkforceContext({
    clock: ctx.clock,
    input: rawInput,
    tenantId,
    auditCtx: ctx,
  });
}
