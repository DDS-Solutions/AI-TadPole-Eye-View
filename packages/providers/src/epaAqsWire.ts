import {
  EPA_AQS_DATA_CLASSIFICATION,
  type EconomicGeography,
  type EpaAqsParameterCode,
  type EpaAqsQuarter,
  type EpaAqsSummaryPeriod,
  type EpaAqsSummaryRecord,
  EpaAqsSummaryRecordSchema,
  type RawEpaAqsSummaryRow,
} from '@gev/contracts';
import { lookupEpaAqsParameter, parseEpaAqsMeasurement } from '@gev/economic';

export function formatAqsDate(year: number, isEnd: boolean): string {
  return isEnd ? `${year}1231` : `${year}0101`;
}

export function normalizeCompleteness(raw: string | null | undefined): 'Y' | 'N' | 'unknown' {
  const upper = raw?.trim().toUpperCase();
  if (upper === 'Y') return 'Y';
  if (upper === 'N') return 'N';
  return 'unknown';
}

export function normalizeEventsIncluded(
  raw: string | null | undefined
): 'Events Included' | 'Events Excluded' | 'No Events' | 'unknown' {
  const trimmed = raw?.trim();
  if (trimmed === 'Events Included' || trimmed === 'Events Excluded' || trimmed === 'No Events') {
    return trimmed;
  }
  return 'unknown';
}

export function buildLiveSummaryPath(
  geography: EconomicGeography,
  summaryPeriod: EpaAqsSummaryPeriod
): string {
  const service = summaryPeriod === 'quarterly' ? 'quarterlyData' : 'annualData';
  switch (geography.level) {
    case 'state':
      return `${service}/byState`;
    case 'county':
      return `${service}/byCounty`;
    case 'cbsa':
      return `${service}/byCBSA`;
    case 'bounding_box':
    case 'point':
      return `${service}/byBox`;
    default:
      throw new Error(`Unsupported EPA AQS live geography level: ${geography.level}`);
  }
}

export function applyGeographyParams(
  url: URL,
  geography: EconomicGeography,
  radiusKm: number
): void {
  switch (geography.level) {
    case 'state':
      url.searchParams.set('state', geography.state_fips);
      break;
    case 'county':
      url.searchParams.set('state', geography.county_fips.slice(0, 2));
      url.searchParams.set('county', geography.county_fips.slice(2, 5));
      break;
    case 'cbsa':
      url.searchParams.set('cbsa', geography.cbsa_code);
      break;
    case 'bounding_box':
      url.searchParams.set('minlat', String(geography.min_lat));
      url.searchParams.set('maxlat', String(geography.max_lat));
      url.searchParams.set('minlon', String(geography.min_lon));
      url.searchParams.set('maxlon', String(geography.max_lon));
      break;
    case 'point': {
      const latDelta = radiusKm / 111.32;
      const cosLat = Math.max(Math.cos((geography.latitude * Math.PI) / 180), 0.1);
      const lonDelta = radiusKm / (111.32 * cosLat);
      url.searchParams.set('minlat', String(Math.max(-90, geography.latitude - latDelta)));
      url.searchParams.set('maxlat', String(Math.min(90, geography.latitude + latDelta)));
      url.searchParams.set('minlon', String(Math.max(-180, geography.longitude - lonDelta)));
      url.searchParams.set('maxlon', String(Math.min(180, geography.longitude + lonDelta)));
      break;
    }
  }
}

export function normalizeLiveSummaryRow(
  row: RawEpaAqsSummaryRow,
  summaryPeriod: EpaAqsSummaryPeriod,
  fallbackGeography: EconomicGeography
): EpaAqsSummaryRecord | null {
  const paramDef = lookupEpaAqsParameter(row.parameter_code);
  if (!paramDef) return null;

  const obsCountRaw =
    typeof row.observation_count === 'number'
      ? row.observation_count
      : Number.parseInt(String(row.observation_count ?? '0'), 10);
  const obsCount = Number.isFinite(obsCountRaw) && obsCountRaw > 0 ? obsCountRaw : 0;
  const unit = row.units_of_measure?.trim() || paramDef.standard_unit;
  const isMonitored = obsCount > 0;
  const parsedYear = Number.parseInt(String(row.year), 10);

  let parsedQuarter: EpaAqsQuarter | null = null;
  if (summaryPeriod === 'quarterly') {
    const qNum = Number.parseInt(String(row.quarter ?? ''), 10);
    if (qNum === 1 || qNum === 2 || qNum === 3 || qNum === 4) {
      parsedQuarter = qNum;
    } else {
      return null;
    }
  }

  const siteId = `${row.state_code.padStart(2, '0')}-${row.county_code.padStart(3, '0')}-${row.site_number.padStart(4, '0')}`;
  const geography: EconomicGeography =
    /^[0-9]{2}$/.test(row.state_code) && /^[0-9]{3}$/.test(row.county_code)
      ? {
          level: 'county',
          county_fips: `${row.state_code}${row.county_code}`,
          state_fips: row.state_code,
          ...(row.county_name ? { name: row.county_name } : {}),
        }
      : fallbackGeography;

  const obsPctNum =
    row.observation_percent === null || row.observation_percent === undefined
      ? null
      : Number.parseFloat(String(row.observation_percent));

  return EpaAqsSummaryRecordSchema.parse({
    site_id: siteId,
    geography,
    parameter_code: paramDef.parameter_code as EpaAqsParameterCode,
    pollutant_symbol: paramDef.pollutant_symbol,
    summary_period: summaryPeriod,
    year: parsedYear,
    quarter: parsedQuarter,
    sample_duration: row.sample_duration?.trim() || (paramDef.averaging_periods[0] ?? '1 HOUR'),
    metric_used: row.metric_used?.trim() || 'Regulatory Summary',
    pollutant_standard: row.pollutant_standard ?? null,
    arithmetic_mean: parseEpaAqsMeasurement(row.arithmetic_mean, unit, obsCount, isMonitored),
    first_max_value: parseEpaAqsMeasurement(row.first_max_value, unit, obsCount, isMonitored),
    second_max_value: parseEpaAqsMeasurement(row.second_max_value, unit, obsCount, isMonitored),
    ninety_eighth_percentile: parseEpaAqsMeasurement(
      row.ninety_eighth_percentile,
      unit,
      obsCount,
      isMonitored
    ),
    observation_count: obsCount,
    observation_percent:
      obsPctNum !== null && Number.isFinite(obsPctNum)
        ? {
            status: 'available',
            value: obsPctNum,
            margin_of_error: null,
            confidence_level: null,
            sample_size: obsCount > 0 ? obsCount : null,
            unit: 'percent',
          }
        : {
            status: 'unavailable',
            reason: 'EPA AQS observation percent missing',
          },
    completeness_indicator: normalizeCompleteness(row.completeness_indicator),
    events_included: normalizeEventsIncluded(row.events_included),
    is_monitored: isMonitored,
    data_classification: EPA_AQS_DATA_CLASSIFICATION,
    is_real_time: false,
  });
}
