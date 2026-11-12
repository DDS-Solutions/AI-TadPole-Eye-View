import { describe, expect, it } from 'vitest';
import {
  type DataProvenance,
  EPA_AQS_BASE_URL,
  EPA_AQS_CRITERIA_POLLUTANTS,
  EPA_AQS_DATA_CLASSIFICATION,
  EPA_AQS_DEFAULT_VINTAGE,
  EPA_AQS_HISTORICAL_DISCLAIMER,
  EPA_AQS_PROHIBITED_REALTIME_HOST,
  EPA_AQS_SCHEMA_VERSION,
  EpaAqsFixtureDatasetSchema,
  EpaAqsMonitoringSiteSchema,
  EpaAqsParameterCodeSchema,
  EpaAqsPollutantCoverageSchema,
  EpaAqsPollutantSymbolSchema,
  EpaAqsQueryResultSchema,
  EpaAqsQuerySchema,
  EpaAqsSiteIdSchema,
  EpaAqsSummaryRecordSchema,
  RawEpaAqsSummaryResponseSchema,
} from '../src/index.js';

describe('EPA AQS Contracts (PLAN.md §10 Task 11.3 & ADR 0064)', () => {
  const sampleProvenance: DataProvenance = {
    schema_version: 1,
    source: {
      provider_id: 'epa-aqs',
      feed_id: 'historical-monitoring',
      name: 'U.S. EPA Air Quality System (AQS)',
      canonical_url: EPA_AQS_BASE_URL,
    },
    retrieved_at: '2026-09-27T12:00:00.000Z',
    observation_period: {
      status: 'available',
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-12-31T23:59:59.000Z',
    },
    vintage: {
      status: 'available',
      value: EPA_AQS_DEFAULT_VINTAGE,
    },
    mode: 'seed',
    source_mode: 'seed',
    license: {
      id: 'us-government-public-domain',
      name: 'U.S. Government Work - 17 U.S.C. 105 (Public Domain)',
    },
    attribution: 'U.S. Environmental Protection Agency, Air Quality System',
    fixture_id: 'epa-aqs-synthetic-v1',
    cache: null,
    freshness: {
      status: 'fresh',
      age_seconds: 0,
      fresh_for_seconds: 2592000,
    },
  };

  it('validates EPA AQS constants and strict historical-only disclaimer', () => {
    expect(EPA_AQS_SCHEMA_VERSION).toBe(1);
    expect(EPA_AQS_BASE_URL).toBe('https://aqs.epa.gov/data/api');
    expect(EPA_AQS_PROHIBITED_REALTIME_HOST).toBe('airnowapi.org');
    expect(EPA_AQS_DATA_CLASSIFICATION).toBe('historical_regulatory_monitoring');
    expect(EPA_AQS_CRITERIA_POLLUTANTS).toEqual(['O3', 'PM2.5', 'PM10', 'CO', 'NO2', 'SO2']);
    expect(EPA_AQS_HISTORICAL_DISCLAIMER).toContain('NOT real-time Air Quality Index (AQI)');
    expect(EPA_AQS_HISTORICAL_DISCLAIMER).toContain('AirNow');
    expect(EPA_AQS_HISTORICAL_DISCLAIMER).toContain('never coerced to 0.0');
  });

  it('validates criteria pollutant symbols, parameter codes, and SS-CCC-NNNN site IDs', () => {
    for (const sym of EPA_AQS_CRITERIA_POLLUTANTS) {
      expect(EpaAqsPollutantSymbolSchema.parse(sym)).toBe(sym);
    }
    expect(() => EpaAqsPollutantSymbolSchema.parse('AQI')).toThrow();

    for (const code of ['44201', '88101', '81102', '42101', '42602', '42401']) {
      expect(EpaAqsParameterCodeSchema.parse(code)).toBe(code);
    }
    expect(() => EpaAqsParameterCodeSchema.parse('99999')).toThrow();

    expect(EpaAqsSiteIdSchema.parse('48-453-0014')).toBe('48-453-0014');
    expect(() => EpaAqsSiteIdSchema.parse('484530014')).toThrow();
  });

  it('enforces monitoring site county_fips and site_id consistency', () => {
    const validSite = EpaAqsMonitoringSiteSchema.parse({
      site_id: '48-453-0014',
      state_fips: '48',
      county_fips: '48453',
      site_number: '0014',
      local_site_name: 'Austin Site',
      county_name: 'Travis',
      state_postal: 'TX',
      latitude: 30.2672,
      longitude: -97.7431,
      monitored_parameters: ['44201', '88101'],
    });
    expect(validSite.site_id).toBe('48-453-0014');

    expect(() =>
      EpaAqsMonitoringSiteSchema.parse({
        site_id: '48-453-0014',
        state_fips: '06',
        county_fips: '48453',
        site_number: '0014',
        local_site_name: 'Mismatched State',
        county_name: 'Travis',
        state_postal: 'TX',
        latitude: 30.2672,
        longitude: -97.7431,
        monitored_parameters: ['44201'],
      })
    ).toThrow();
  });

  it('enforces non-coercion invariant: unmonitored or zero-observation summaries cannot be available', () => {
    expect(() =>
      EpaAqsSummaryRecordSchema.parse({
        site_id: '48-453-0014',
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
        parameter_code: '42101',
        pollutant_symbol: 'CO',
        summary_period: 'annual',
        year: 2024,
        quarter: null,
        sample_duration: '8-HR RUN AVG END HOUR',
        metric_used: 'Daily Max 8-hour',
        arithmetic_mean: {
          status: 'available',
          value: 0.0,
          margin_of_error: null,
          confidence_level: null,
          sample_size: 0,
          unit: 'ppm',
        },
        first_max_value: { status: 'unavailable', reason: 'Unmonitored' },
        second_max_value: { status: 'unavailable', reason: 'Unmonitored' },
        ninety_eighth_percentile: { status: 'unavailable', reason: 'Unmonitored' },
        observation_count: 0,
        observation_percent: { status: 'unavailable', reason: 'Unmonitored' },
        completeness_indicator: 'unknown',
        is_monitored: false,
        data_classification: EPA_AQS_DATA_CLASSIFICATION,
        is_real_time: false,
      })
    ).toThrow(/Non-coercion law/);
  });

  it('rejects real-time labeling or annual summary with a quarter value', () => {
    expect(() =>
      EpaAqsQuerySchema.parse({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
        summary_period: 'annual',
        quarter: 2,
      })
    ).toThrow(/quarter cannot be specified/);

    expect(() =>
      EpaAqsPollutantCoverageSchema.parse({
        pollutant_symbol: 'SO2',
        parameter_code: '42401',
        is_monitored: false,
        site_count: 0,
        summary_count: 0,
        latest_arithmetic_mean: {
          status: 'available',
          value: 0,
          margin_of_error: null,
          confidence_level: null,
          sample_size: 0,
          unit: 'ppb',
        },
        data_classification: EPA_AQS_DATA_CLASSIFICATION,
        is_real_time: false,
      })
    ).toThrow(/Non-coercion law/);
  });

  it('validates raw EPA AQS wire response, query result, and fixture dataset schemas', () => {
    const rawWire = RawEpaAqsSummaryResponseSchema.parse({
      Header: [{ status: 'Success', rows: 1 }],
      Data: [
        {
          state_code: '48',
          county_code: '453',
          site_number: '0014',
          parameter_code: '44201',
          year: 2024,
          units_of_measure: 'Parts per million',
          arithmetic_mean: 0.044,
          first_max_value: 0.072,
          observation_count: 352,
          observation_percent: 96.4,
          completeness_indicator: 'Y',
        },
      ],
    });
    expect(rawWire.Data).toHaveLength(1);

    const unavailable = { status: 'unavailable' as const, reason: 'Unmonitored' };
    const summary = EpaAqsSummaryRecordSchema.parse({
      site_id: '48-453-0014',
      geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      parameter_code: '42101',
      pollutant_symbol: 'CO',
      summary_period: 'quarterly',
      year: 2024,
      quarter: 1,
      sample_duration: '8-hour',
      metric_used: 'Unmonitored pollutant placeholder',
      arithmetic_mean: unavailable,
      first_max_value: unavailable,
      second_max_value: unavailable,
      ninety_eighth_percentile: unavailable,
      observation_count: 0,
      observation_percent: unavailable,
      completeness_indicator: 'unknown',
      is_monitored: false,
      data_classification: EPA_AQS_DATA_CLASSIFICATION,
      is_real_time: false,
    });

    const site = EpaAqsMonitoringSiteSchema.parse({
      site_id: '48-453-0014',
      state_fips: '48',
      county_fips: '48453',
      site_number: '0014',
      local_site_name: 'Austin Site',
      county_name: 'Travis',
      state_postal: 'TX',
      latitude: 30.2672,
      longitude: -97.7431,
      monitored_parameters: ['44201'],
    });

    const result = EpaAqsQueryResultSchema.parse({
      geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      data_classification: EPA_AQS_DATA_CLASSIFICATION,
      is_real_time: false,
      sites: [site],
      summaries: [summary],
      pollutant_coverage: [
        {
          pollutant_symbol: 'CO',
          parameter_code: '42101',
          is_monitored: false,
          site_count: 0,
          summary_count: 0,
          latest_arithmetic_mean: unavailable,
          data_classification: EPA_AQS_DATA_CLASSIFICATION,
          is_real_time: false,
        },
      ],
      provenance: sampleProvenance,
      advisory_disclaimer: EPA_AQS_HISTORICAL_DISCLAIMER,
    });
    expect(result.is_real_time).toBe(false);

    const fixture = EpaAqsFixtureDatasetSchema.parse({
      schema_version: 1,
      fixture_id: 'epa-aqs-synthetic-v1',
      source_id: 'epa-aqs',
      title: 'Test AQS Fixture',
      description: 'Test description',
      data_classification: EPA_AQS_DATA_CLASSIFICATION,
      is_real_time: false,
      provenance: sampleProvenance,
      sites: [site],
      summaries: [summary],
    });
    expect(fixture.fixture_id).toBe('epa-aqs-synthetic-v1');
  });
});
