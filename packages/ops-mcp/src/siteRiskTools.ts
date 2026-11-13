import type {
  AssessSiteRiskInput,
  AssessSiteRiskOutput,
  EconomicEvidenceRecord,
  EconomicGeography,
} from '@gev/contracts';
import type { SimClock, ToolExecutionContext } from '@gev/core';
import { type SiteRiskOperationalAlertInput, assessSiteRisk } from '@gev/economic';
import {
  DotBtsAdapter,
  EpaAqsAdapter,
  FemaNfhlAdapter,
  FemaNriAdapter,
  NwsAlertsAdapter,
  Usgs3DepAdapter,
} from '@gev/providers';
import type { OperatorContext } from './context.js';
import { assertEconomicToolAllowed, sanitizeEconomicText } from './economicToolGovernance.js';

export interface ResolveSiteRiskOptions {
  clock: SimClock;
  input: AssessSiteRiskInput;
  tenantId?: string;
  auditCtx?: Pick<OperatorContext, 'auditSink' | 'clock'>;
  femaNriAdapter?: FemaNriAdapter;
  femaNfhlAdapter?: FemaNfhlAdapter;
  usgs3DepAdapter?: Usgs3DepAdapter;
  epaAqsAdapter?: EpaAqsAdapter;
  dotBtsAdapter?: DotBtsAdapter;
  nwsAlertsAdapter?: NwsAlertsAdapter;
}

function resolveCountyGeography(geo: EconomicGeography): EconomicGeography {
  if (geo.level === 'county') return geo;
  if (
    geo.level === 'place' &&
    (geo.place_fips === '4805000' || geo.name?.toLowerCase().includes('austin'))
  ) {
    return { level: 'county', county_fips: '48453', state_fips: '48', name: 'Travis County, TX' };
  }
  if (geo.level === 'zcta' && geo.zcta.startsWith('787')) {
    return { level: 'county', county_fips: '48453', state_fips: '48', name: 'Travis County, TX' };
  }
  return geo;
}

const cachedAdapters = new WeakMap<
  SimClock,
  {
    femaNri: FemaNriAdapter;
    femaNfhl: FemaNfhlAdapter;
    usgs3Dep: Usgs3DepAdapter;
    epaAqs: EpaAqsAdapter;
    dotBts: DotBtsAdapter;
    nwsAlerts: NwsAlertsAdapter;
  }
>();

function getDefaultAdapters(clock: SimClock) {
  let entry = cachedAdapters.get(clock);
  if (!entry) {
    entry = {
      femaNri: new FemaNriAdapter({ clock }),
      femaNfhl: new FemaNfhlAdapter({ clock }),
      usgs3Dep: new Usgs3DepAdapter({ clock }),
      epaAqs: new EpaAqsAdapter({ clock }),
      dotBts: new DotBtsAdapter({ clock }),
      nwsAlerts: new NwsAlertsAdapter({ clock }),
    };
    cachedAdapters.set(clock, entry);
  }
  return entry;
}

export async function resolveAndAssessSiteRisk(
  options: ResolveSiteRiskOptions
): Promise<AssessSiteRiskOutput> {
  const { clock, input } = options;
  const tenantId = options.tenantId ?? input.tenant_id ?? 'tenant-local';
  const defaults = getDefaultAdapters(clock);

  const femaNri = options.femaNriAdapter ?? defaults.femaNri;
  const femaNfhl = options.femaNfhlAdapter ?? defaults.femaNfhl;
  const usgs3Dep = options.usgs3DepAdapter ?? defaults.usgs3Dep;
  const epaAqs = options.epaAqsAdapter ?? defaults.epaAqs;
  const dotBts = options.dotBtsAdapter ?? defaults.dotBts;
  const nwsAlerts = options.nwsAlertsAdapter ?? defaults.nwsAlerts;

  const countyGeo = resolveCountyGeography(input.geography);
  const adapterErrors: string[] = [];
  const recordAdapterError = (source: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    adapterErrors.push(`Provider adapter failure (${source}): ${msg}`);
  };

  const [femaNriRecords, dotBtsRecord, epaAqsResult] = await Promise.all([
    countyGeo.level === 'county' || countyGeo.level === 'tract' || countyGeo.level === 'state'
      ? femaNri.query({ geography: countyGeo }).catch((err: unknown) => {
          recordAdapterError('fema-nri', err);
          return [] as readonly EconomicEvidenceRecord[];
        })
      : Promise.resolve([] as readonly EconomicEvidenceRecord[]),
    countyGeo.level === 'county' || countyGeo.level === 'cbsa' || countyGeo.level === 'state'
      ? dotBts
          .queryAccessibility({ geography: countyGeo })
          .then((res) => res.records[0])
          .catch((err: unknown) => {
            recordAdapterError('dot-bts', err);
            return undefined;
          })
      : Promise.resolve(undefined),
    countyGeo.level === 'state' ||
    countyGeo.level === 'county' ||
    countyGeo.level === 'cbsa' ||
    countyGeo.level === 'point' ||
    countyGeo.level === 'bounding_box'
      ? epaAqs
          .querySummaries({ geography: countyGeo, summary_period: 'annual' })
          .catch((err: unknown) => {
            recordAdapterError('epa-aqs', err);
            return undefined;
          })
      : Promise.resolve(undefined),
  ]);

  const queryPoint =
    input.point ??
    (input.geography.level === 'point'
      ? { x: input.geography.longitude, y: input.geography.latitude }
      : dotBtsRecord?.centroid
        ? { x: dotBtsRecord.centroid.longitude, y: dotBtsRecord.centroid.latitude }
        : undefined);

  const [femaNfhlSummary, usgsElevation, nwsAlertsList] = await Promise.all([
    countyGeo.level === 'county' ||
    countyGeo.level === 'state' ||
    countyGeo.level === 'point' ||
    countyGeo.level === 'bounding_box'
      ? femaNfhl
          .getFloodSummary({
            geography: countyGeo,
            ...(queryPoint ? { point: { latitude: queryPoint.y, longitude: queryPoint.x } } : {}),
          })
          .catch((err: unknown) => {
            recordAdapterError('fema-nfhl', err);
            return undefined;
          })
      : Promise.resolve(undefined),
    queryPoint
      ? usgs3Dep
          .getElevation({ x: queryPoint.x, y: queryPoint.y, units: 'Meters' })
          .catch((err: unknown) => {
            recordAdapterError('usgs-3dep', err);
            return undefined;
          })
      : Promise.resolve(undefined),
    !input.current_alerts && input.include_current_alerts !== false && queryPoint
      ? nwsAlerts
          .getAlerts({
            min_lat: Math.max(-90, queryPoint.y - 0.5),
            max_lat: Math.min(90, queryPoint.y + 0.5),
            min_lon: Math.max(-180, queryPoint.x - 0.5),
            max_lon: Math.min(180, queryPoint.x + 0.5),
          })
          .then((col) =>
            col.alerts.map((a) => ({
              id: a.id,
              event: sanitizeEconomicText(a.event, 'nws_alert_event', tenantId, options.auditCtx),
              severity: a.severity,
              headline: a.headline
                ? sanitizeEconomicText(a.headline, 'nws_alert_headline', tenantId, options.auditCtx)
                : undefined,
            }))
          )
          .catch((err: unknown) => {
            recordAdapterError('nws-alerts', err);
            return undefined;
          })
      : Promise.resolve(undefined),
  ]);

  const currentAlerts: SiteRiskOperationalAlertInput[] | undefined =
    input.current_alerts?.map((a) => ({
      ...a,
      event: sanitizeEconomicText(a.event, 'caller_alert_event', tenantId, options.auditCtx),
      ...(a.headline
        ? {
            headline: sanitizeEconomicText(
              a.headline,
              'caller_alert_headline',
              tenantId,
              options.auditCtx
            ),
          }
        : {}),
    })) ?? nwsAlertsList;

  const result = assessSiteRisk({
    geography: input.geography,
    isoTimestamp: new Date(clock.now()).toISOString(),
    femaNriRecords,
    femaNfhlSummary,
    usgsElevation,
    epaAqsResult,
    dotBtsRecord,
    currentAlerts,
  });

  if (adapterErrors.length > 0) {
    return {
      ...result,
      data_gaps: [...result.data_gaps, ...adapterErrors],
    };
  }
  return result;
}

export async function handleAssessSiteRisk(
  ctx: OperatorContext,
  rawInput: AssessSiteRiskInput,
  executionContext: ToolExecutionContext = {}
): Promise<AssessSiteRiskOutput> {
  const tenantId = assertEconomicToolAllowed(ctx, executionContext, 'site-risk screening tool');

  return resolveAndAssessSiteRisk({
    clock: ctx.clock,
    input: { ...rawInput, tenant_id: tenantId },
    tenantId,
    auditCtx: ctx,
  });
}
