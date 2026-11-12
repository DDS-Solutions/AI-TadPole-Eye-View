import {
  EPA_AQS_CRITERIA_POLLUTANTS,
  EPA_AQS_DATA_CLASSIFICATION,
  EPA_AQS_DEFAULT_VINTAGE,
  EPA_AQS_HISTORICAL_DISCLAIMER,
  EPA_AQS_PROHIBITED_REALTIME_HOST,
  EPA_AQS_SCHEMA_VERSION,
  type EconomicEstimate,
  type EconomicGeography,
  type EpaAqsMonitoringSite,
  type EpaAqsParameterCode,
  type EpaAqsParameterDefinition,
  EpaAqsParameterDefinitionSchema,
  type EpaAqsPollutantCoverage,
  EpaAqsPollutantCoverageSchema,
  type EpaAqsPollutantSymbol,
  type EpaAqsQuarter,
  type EpaAqsSummaryPeriod,
  type EpaAqsSummaryRecord,
  EpaAqsSummaryRecordSchema,
} from '@gev/contracts';
import { haversineDistanceMeters } from './usgs3depConversions.js';

export {
  EPA_AQS_SCHEMA_VERSION,
  EPA_AQS_DEFAULT_VINTAGE,
  EPA_AQS_HISTORICAL_DISCLAIMER,
  EPA_AQS_DATA_CLASSIFICATION,
  EPA_AQS_CRITERIA_POLLUTANTS,
};

// ============================================================================
// Versioned EPA AQS Criteria Pollutant Parameter Dictionary (V1)
// ============================================================================

export const EPA_AQS_PARAMETERS_V1: Record<EpaAqsParameterCode, EpaAqsParameterDefinition> = {
  '44201': EpaAqsParameterDefinitionSchema.parse({
    parameter_code: '44201',
    pollutant_symbol: 'O3',
    name: 'Ozone',
    standard_unit: 'ppm',
    averaging_periods: ['1-hour', '8-hour'],
    naaqs_primary_standard: '0.070 ppm (8-hour annual 4th-highest daily max, 3-yr avg)',
    description:
      'Ground-level ozone (O3) criteria pollutant measured via federal reference/equivalent regulatory analyzers.',
  }),
  '88101': EpaAqsParameterDefinitionSchema.parse({
    parameter_code: '88101',
    pollutant_symbol: 'PM2.5',
    name: 'PM2.5 - Local Conditions (FRM/FEM Mass)',
    standard_unit: 'ug/m3',
    averaging_periods: ['24-hour', 'annual'],
    naaqs_primary_standard: '9.0 ug/m3 (annual mean); 35 ug/m3 (24-hour 98th percentile)',
    description:
      'Fine particulate matter <= 2.5 micrometers aerodynamic diameter (FRM/FEM regulatory mass concentration).',
  }),
  '81102': EpaAqsParameterDefinitionSchema.parse({
    parameter_code: '81102',
    pollutant_symbol: 'PM10',
    name: 'PM10 Total 0-10um STP',
    standard_unit: 'ug/m3',
    averaging_periods: ['24-hour'],
    naaqs_primary_standard: '150 ug/m3 (24-hour, not to be exceeded > 1/yr over 3 yrs)',
    description:
      'Coarse inhalable particulate matter <= 10 micrometers aerodynamic diameter at standard temperature and pressure.',
  }),
  '42101': EpaAqsParameterDefinitionSchema.parse({
    parameter_code: '42101',
    pollutant_symbol: 'CO',
    name: 'Carbon monoxide',
    standard_unit: 'ppm',
    averaging_periods: ['1-hour', '8-hour'],
    naaqs_primary_standard: '9 ppm (8-hour); 35 ppm (1-hour)',
    description:
      'Ambient carbon monoxide (CO) regulatory concentration measured at stationary monitoring stations.',
  }),
  '42602': EpaAqsParameterDefinitionSchema.parse({
    parameter_code: '42602',
    pollutant_symbol: 'NO2',
    name: 'Nitrogen dioxide (NO2)',
    standard_unit: 'ppb',
    averaging_periods: ['1-hour', 'annual'],
    naaqs_primary_standard: '100 ppb (1-hour 98th percentile); 53 ppb (annual mean)',
    description:
      'Nitrogen dioxide (NO2) regulatory monitoring measurements for combustion-related ambient screening.',
  }),
  '42401': EpaAqsParameterDefinitionSchema.parse({
    parameter_code: '42401',
    pollutant_symbol: 'SO2',
    name: 'Sulfur dioxide',
    standard_unit: 'ppb',
    averaging_periods: ['1-hour'],
    naaqs_primary_standard: '75 ppb (1-hour 99th percentile daily max)',
    description:
      'Sulfur dioxide (SO2) regulatory monitoring measurements near industrial and urban corridors.',
  }),
};

const SYMBOL_TO_CODE: Record<EpaAqsPollutantSymbol, EpaAqsParameterCode> = {
  O3: '44201',
  'PM2.5': '88101',
  PM10: '81102',
  CO: '42101',
  NO2: '42602',
  SO2: '42401',
};

export function listEpaAqsParameters(): EpaAqsParameterDefinition[] {
  return Object.values(EPA_AQS_PARAMETERS_V1);
}

export function getEpaAqsParameterCode(symbol: EpaAqsPollutantSymbol): EpaAqsParameterCode {
  return SYMBOL_TO_CODE[symbol];
}

export function getEpaAqsPollutantSymbol(code: EpaAqsParameterCode): EpaAqsPollutantSymbol {
  return EPA_AQS_PARAMETERS_V1[code].pollutant_symbol;
}

export function lookupEpaAqsParameter(symbolOrCode: string): EpaAqsParameterDefinition | undefined {
  const trimmed = symbolOrCode.trim();
  if (trimmed in EPA_AQS_PARAMETERS_V1) {
    return EPA_AQS_PARAMETERS_V1[trimmed as EpaAqsParameterCode];
  }
  const upper = trimmed.toUpperCase();
  if (upper === 'PM25' || upper === 'PM2.5') {
    return EPA_AQS_PARAMETERS_V1['88101'];
  }
  if (upper in SYMBOL_TO_CODE) {
    return EPA_AQS_PARAMETERS_V1[SYMBOL_TO_CODE[upper as EpaAqsPollutantSymbol]];
  }
  return undefined;
}

// ============================================================================
// Pure Geography & Endpoint Validators
// ============================================================================

const ALLOWED_EPA_AQS_GEOGRAPHIES = ['state', 'county', 'cbsa', 'point', 'bounding_box'] as const;

export function validateEpaAqsGeography(geography: EconomicGeography): void {
  if (!(ALLOWED_EPA_AQS_GEOGRAPHIES as readonly string[]).includes(geography.level)) {
    throw new Error(
      `EPA AQS supports geographies: ${ALLOWED_EPA_AQS_GEOGRAPHIES.join(', ')}. Received unsupported level '${geography.level}'`
    );
  }
}

export function validateEpaAqsEndpoint(endpointUrl: string): void {
  const lower = endpointUrl.toLowerCase();
  if (lower.includes(EPA_AQS_PROHIBITED_REALTIME_HOST) || lower.includes('airnow')) {
    throw new Error(
      'AirNow real-time AQI endpoints are out of scope for EPA AQS (PLAN.md §10 Task 11.3); EPA AQS provides historical/regulatory monitoring data only.'
    );
  }
  const parsed = new URL(endpointUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error(`EPA AQS endpoint must use HTTPS, received '${parsed.protocol}'`);
  }
}

// ============================================================================
// Non-Coercion Measurement Parser & Unmonitored Builder
// ============================================================================

/**
 * Parses a raw EPA AQS summary statistic into an EconomicEstimate.
 * Non-coercion law:
 * - Unmonitored pollutants, zero observations, null/empty/NaN, or negative values
 *   MUST evaluate to `{ status: 'unavailable' }` and NEVER coerce to `0.0`.
 * - Legitimate `0.0` readings with `isMonitored === true` and `observationCount > 0`
 *   remain `{ status: 'available', value: 0 }`.
 */
export function parseEpaAqsMeasurement(
  rawValue: number | string | null | undefined,
  unit: string,
  observationCount: number,
  isMonitored: boolean,
  notes?: string
): EconomicEstimate {
  if (!isMonitored) {
    return {
      status: 'unavailable',
      reason: 'Pollutant is not monitored at this EPA AQS site or geography',
    };
  }

  if (!Number.isInteger(observationCount) || observationCount <= 0) {
    return {
      status: 'unavailable',
      reason: 'Zero valid observations recorded for this EPA AQS summary period',
    };
  }

  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return {
      status: 'unavailable',
      reason: 'EPA AQS measurement value is missing or unreported',
    };
  }

  const numericVal = typeof rawValue === 'number' ? rawValue : Number.parseFloat(String(rawValue));
  if (!Number.isFinite(numericVal) || numericVal < 0) {
    return {
      status: 'unavailable',
      reason: `EPA AQS measurement value is invalid or negative (${String(rawValue)})`,
    };
  }

  return {
    status: 'available',
    value: numericVal,
    margin_of_error: null,
    confidence_level: null,
    sample_size: observationCount,
    unit,
    ...(notes ? { notes } : {}),
  };
}

export interface UnmonitoredSummaryInput {
  site_id: string;
  geography: EconomicGeography;
  parameter_code: EpaAqsParameterCode;
  summary_period: EpaAqsSummaryPeriod;
  year: number;
  quarter: EpaAqsQuarter | null;
  reason?: string;
}

export function createUnmonitoredEpaAqsSummary(
  input: UnmonitoredSummaryInput
): EpaAqsSummaryRecord {
  const param = EPA_AQS_PARAMETERS_V1[input.parameter_code];
  const unavailable: EconomicEstimate = {
    status: 'unavailable',
    reason:
      input.reason ??
      `Pollutant ${param.pollutant_symbol} (${param.parameter_code}) is not monitored at site ${input.site_id}`,
  };

  return EpaAqsSummaryRecordSchema.parse({
    site_id: input.site_id,
    geography: input.geography,
    parameter_code: param.parameter_code,
    pollutant_symbol: param.pollutant_symbol,
    summary_period: input.summary_period,
    year: input.year,
    quarter: input.quarter,
    sample_duration: param.averaging_periods[0] ?? 'N/A',
    metric_used: 'Unmonitored pollutant placeholder (no regulatory analyzer at site)',
    pollutant_standard: param.naaqs_primary_standard,
    arithmetic_mean: unavailable,
    first_max_value: unavailable,
    second_max_value: unavailable,
    ninety_eighth_percentile: unavailable,
    observation_count: 0,
    observation_percent: unavailable,
    completeness_indicator: 'unknown',
    events_included: 'unknown',
    is_monitored: false,
    data_classification: EPA_AQS_DATA_CLASSIFICATION,
    is_real_time: false,
  });
}

// ============================================================================
// Site Spatial Matching & Coverage Synthesis
// ============================================================================

export function matchesSiteGeography(
  site: EpaAqsMonitoringSite,
  geography: EconomicGeography,
  radiusKm = 50
): boolean {
  switch (geography.level) {
    case 'state':
      return site.state_fips === geography.state_fips;
    case 'county':
      return site.county_fips === geography.county_fips;
    case 'cbsa':
      return site.cbsa_code === geography.cbsa_code;
    case 'bounding_box':
      return (
        site.latitude >= geography.min_lat &&
        site.latitude <= geography.max_lat &&
        site.longitude >= geography.min_lon &&
        site.longitude <= geography.max_lon
      );
    case 'point': {
      const distanceMeters = haversineDistanceMeters(
        geography.latitude,
        geography.longitude,
        site.latitude,
        site.longitude
      );
      return distanceMeters <= radiusKm * 1000;
    }
    default:
      return false;
  }
}

function compareSummaryRecency(a: EpaAqsSummaryRecord, b: EpaAqsSummaryRecord): number {
  if (a.year !== b.year) return b.year - a.year;
  // Prefer annual over quarterly within the same year, or higher quarter first
  if (a.summary_period !== b.summary_period) {
    return a.summary_period === 'annual' ? -1 : 1;
  }
  return (b.quarter ?? 0) - (a.quarter ?? 0);
}

export function summarizeEpaAqsPollutantCoverage(
  sites: readonly EpaAqsMonitoringSite[],
  summaries: readonly EpaAqsSummaryRecord[],
  requestedPollutants: readonly EpaAqsPollutantSymbol[] = EPA_AQS_CRITERIA_POLLUTANTS
): EpaAqsPollutantCoverage[] {
  return requestedPollutants.map((symbol) => {
    const code = getEpaAqsParameterCode(symbol);
    const monitoringSites = sites.filter((s) => s.monitored_parameters.includes(code));
    const monitoredSummaries = summaries
      .filter((s) => s.pollutant_symbol === symbol && s.is_monitored)
      .sort(compareSummaryRecency);

    const latestAvailable = monitoredSummaries.find(
      (s) => s.arithmetic_mean.status === 'available'
    );

    const isMonitored = monitoringSites.length > 0 || monitoredSummaries.length > 0;
    const latestMean: EconomicEstimate = !isMonitored
      ? {
          status: 'unavailable',
          reason: `Pollutant ${symbol} (${code}) is not monitored in the matched EPA AQS geography`,
        }
      : latestAvailable
        ? latestAvailable.arithmetic_mean
        : {
            status: 'unavailable',
            reason: `Pollutant ${symbol} (${code}) has no valid historical summary observations for the requested period`,
          };

    return EpaAqsPollutantCoverageSchema.parse({
      pollutant_symbol: symbol,
      parameter_code: code,
      is_monitored: isMonitored,
      site_count: monitoringSites.length,
      summary_count: monitoredSummaries.length,
      latest_arithmetic_mean: latestMean,
      data_classification: EPA_AQS_DATA_CLASSIFICATION,
      is_real_time: false,
    });
  });
}
