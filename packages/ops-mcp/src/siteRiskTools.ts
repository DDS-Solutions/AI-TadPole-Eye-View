import type {
  AssessSiteRiskInput,
  AssessSiteRiskOutput,
  EconomicEvidenceRecord,
  EconomicGeography,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
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

export interface ResolveSiteRiskOptions {
  clock: SimClock;
  input: AssessSiteRiskInput;
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

const cachedSeedAdapters = new WeakMap<
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

function getSeedAdapters(clock: SimClock) {
  let entry = cachedSeedAdapters.get(clock);
  if (!entry) {
    entry = {
      femaNri: new FemaNriAdapter({ clock, seedMode: true }),
      femaNfhl: new FemaNfhlAdapter({ clock, seedMode: true }),
      usgs3Dep: new Usgs3DepAdapter({ clock, seedMode: true }),
      epaAqs: new EpaAqsAdapter({ clock, seedMode: true }),
      dotBts: new DotBtsAdapter({ clock, seedMode: true }),
      nwsAlerts: new NwsAlertsAdapter({ clock, seedMode: true }),
    };
    cachedSeedAdapters.set(clock, entry);
  }
  return entry;
}

export async function resolveAndAssessSiteRisk(
  options: ResolveSiteRiskOptions
): Promise<AssessSiteRiskOutput> {
  const { clock, input } = options;
  const defaults = getSeedAdapters(clock);

  const femaNri = options.femaNriAdapter ?? defaults.femaNri;
  const femaNfhl = options.femaNfhlAdapter ?? defaults.femaNfhl;
  const usgs3Dep = options.usgs3DepAdapter ?? defaults.usgs3Dep;
  const epaAqs = options.epaAqsAdapter ?? defaults.epaAqs;
  const dotBts = options.dotBtsAdapter ?? defaults.dotBts;
  const nwsAlerts = options.nwsAlertsAdapter ?? defaults.nwsAlerts;

  const countyGeo = resolveCountyGeography(input.geography);

  const [femaNriRecords, dotBtsRecord, epaAqsResult] = await Promise.all([
    countyGeo.level === 'county' || countyGeo.level === 'tract' || countyGeo.level === 'state'
      ? femaNri.query({ geography: countyGeo }).catch(() => [] as readonly EconomicEvidenceRecord[])
      : Promise.resolve([] as readonly EconomicEvidenceRecord[]),
    dotBts
      .queryAccessibility({ geography: countyGeo })
      .then((res) => res.records[0])
      .catch(() => undefined),
    countyGeo.level === 'state' ||
    countyGeo.level === 'county' ||
    countyGeo.level === 'cbsa' ||
    countyGeo.level === 'point' ||
    countyGeo.level === 'bounding_box'
      ? epaAqs
          .querySummaries({ geography: countyGeo, summary_period: 'annual' })
          .catch(() => undefined)
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
    femaNfhl
      .getFloodSummary({
        geography: countyGeo,
        ...(queryPoint ? { point: { latitude: queryPoint.y, longitude: queryPoint.x } } : {}),
      })
      .catch(() => undefined),
    queryPoint
      ? usgs3Dep
          .getElevation({ x: queryPoint.x, y: queryPoint.y, units: 'Meters' })
          .catch(() => undefined)
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
              event: a.event,
              severity: a.severity,
              headline: a.headline,
            }))
          )
          .catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  const currentAlerts: SiteRiskOperationalAlertInput[] | undefined =
    input.current_alerts ?? nwsAlertsList;

  return assessSiteRisk({
    geography: input.geography,
    isoTimestamp: new Date(clock.now()).toISOString(),
    femaNriRecords,
    femaNfhlSummary,
    usgsElevation,
    epaAqsResult,
    dotBtsRecord,
    currentAlerts,
  });
}

export async function handleAssessSiteRisk(
  ctx: OperatorContext,
  rawInput: AssessSiteRiskInput
): Promise<AssessSiteRiskOutput> {
  if (ctx.budgetGovernor.state().stasis_active) {
    throw new Error('STASIS: site-risk screening tool is suspended');
  }
  if (ctx.flags.get('economic.enabled') === false) {
    throw new Error('Economic analysis engine is disabled by kill-switch policy');
  }

  return resolveAndAssessSiteRisk({
    clock: ctx.clock,
    input: rawInput,
  });
}
