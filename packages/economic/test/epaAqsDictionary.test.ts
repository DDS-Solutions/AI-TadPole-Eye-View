import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EPA_AQS_CRITERIA_POLLUTANTS,
  EPA_AQS_DATA_CLASSIFICATION,
  EPA_AQS_PARAMETERS_V1,
  createUnmonitoredEpaAqsSummary,
  getEpaAqsParameterCode,
  getEpaAqsPollutantSymbol,
  listEpaAqsParameters,
  lookupEpaAqsParameter,
  matchesSiteGeography,
  parseEpaAqsMeasurement,
  summarizeEpaAqsPollutantCoverage,
  validateEpaAqsEndpoint,
  validateEpaAqsGeography,
} from '../src/epaAqsDictionary.js';
import { ECONOMIC_SOURCE_REGISTRY } from '../src/sourceRegistry.js';

describe('EPA AQS Parameter Dictionary & Non-Coercion Logic (PLAN.md §10 Task 11.3 & ADR 0064)', () => {
  it('registers all 6 criteria pollutants in EPA_AQS_PARAMETERS_V1', () => {
    const list = listEpaAqsParameters();
    expect(list).toHaveLength(6);

    for (const symbol of EPA_AQS_CRITERIA_POLLUTANTS) {
      const code = getEpaAqsParameterCode(symbol);
      expect(getEpaAqsPollutantSymbol(code)).toBe(symbol);
      expect(EPA_AQS_PARAMETERS_V1[code].pollutant_symbol).toBe(symbol);
    }

    expect(lookupEpaAqsParameter('pm25')?.parameter_code).toBe('88101');
    expect(lookupEpaAqsParameter('PM2.5')?.parameter_code).toBe('88101');
    expect(lookupEpaAqsParameter('44201')?.pollutant_symbol).toBe('O3');
    expect(lookupEpaAqsParameter('unknown')).toBeUndefined();
  });

  it('rejects AirNow real-time AQI endpoints and non-HTTPS endpoints', () => {
    expect(() => validateEpaAqsEndpoint('https://aqs.epa.gov/data/api')).not.toThrow();
    expect(() =>
      validateEpaAqsEndpoint('https://www.airnowapi.org/aq/observation/zipCode/current/')
    ).toThrow(/AirNow real-time AQI endpoints are out of scope/);
    expect(() => validateEpaAqsEndpoint('https://example.com/airnow/current')).toThrow(
      /AirNow real-time AQI/
    );
    expect(() => validateEpaAqsEndpoint('http://aqs.epa.gov/data/api')).toThrow(/HTTPS/);
  });

  it('validates supported EPA AQS geography levels', () => {
    expect(() =>
      validateEpaAqsGeography({ level: 'county', county_fips: '48453', state_fips: '48' })
    ).not.toThrow();
    expect(() => validateEpaAqsGeography({ level: 'state', state_fips: '48' })).not.toThrow();
    expect(() => validateEpaAqsGeography({ level: 'cbsa', cbsa_code: '12420' })).not.toThrow();
    expect(() =>
      validateEpaAqsGeography({ level: 'point', latitude: 30.26, longitude: -97.74 })
    ).not.toThrow();
    expect(() =>
      validateEpaAqsGeography({
        level: 'bounding_box',
        min_lat: 30.0,
        max_lat: 31.0,
        min_lon: -98.0,
        max_lon: -97.0,
      })
    ).not.toThrow();
    expect(() => validateEpaAqsGeography({ level: 'nation', country_code: 'US' })).toThrow(
      /EPA AQS supports geographies/
    );
  });

  it('non-coercion law: never coerces unmonitored, missing, or zero-observation measurements to 0.0', () => {
    expect(parseEpaAqsMeasurement(0, 'ppm', 100, false).status).toBe('unavailable');
    expect(parseEpaAqsMeasurement(0, 'ppm', 0, true).status).toBe('unavailable');
    expect(parseEpaAqsMeasurement(null, 'ppm', 100, true).status).toBe('unavailable');
    expect(parseEpaAqsMeasurement(undefined, 'ppm', 100, true).status).toBe('unavailable');
    expect(parseEpaAqsMeasurement('', 'ppm', 100, true).status).toBe('unavailable');
    expect(parseEpaAqsMeasurement(-1.5, 'ppm', 100, true).status).toBe('unavailable');

    // Legitimate 0.0 reading with active monitoring and positive observation_count remains available
    const validZero = parseEpaAqsMeasurement(0.0, 'ppm', 2100, true);
    expect(validZero.status).toBe('available');
    if (validZero.status === 'available') {
      expect(validZero.value).toBe(0);
      expect(validZero.sample_size).toBe(2100);
      expect(validZero.unit).toBe('ppm');
    }
  });

  it('property test: unmonitored or zero-observation inputs always evaluate to unavailable', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.double({ min: -100, max: 500, noNaN: true })
        ),
        fc.integer({ min: 0, max: 10000 }),
        (rawVal, obsCount) => {
          const unmonitored = parseEpaAqsMeasurement(rawVal, 'ppm', obsCount, false);
          expect(unmonitored.status).toBe('unavailable');

          const zeroObs = parseEpaAqsMeasurement(rawVal, 'ppm', 0, true);
          expect(zeroObs.status).toBe('unavailable');
        }
      )
    );
  });

  it('builds unmonitored summary records and pollutant coverage without zero-coercion', () => {
    const unmonitored = createUnmonitoredEpaAqsSummary({
      site_id: '48-453-0014',
      geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      parameter_code: '42401',
      summary_period: 'annual',
      year: 2024,
      quarter: null,
    });

    expect(unmonitored.is_monitored).toBe(false);
    expect(unmonitored.is_real_time).toBe(false);
    expect(unmonitored.data_classification).toBe(EPA_AQS_DATA_CLASSIFICATION);
    expect(unmonitored.arithmetic_mean.status).toBe('unavailable');
    expect(unmonitored.first_max_value.status).toBe('unavailable');

    const coverage = summarizeEpaAqsPollutantCoverage(
      [
        {
          site_id: '48-453-0014',
          state_fips: '48',
          county_fips: '48453',
          site_number: '0014',
          local_site_name: 'Austin Site',
          county_name: 'Travis',
          state_postal: 'TX',
          cbsa_code: '12420',
          latitude: 30.2672,
          longitude: -97.7431,
          datum: 'WGS84',
          monitored_parameters: ['44201'],
        },
      ],
      [unmonitored],
      ['O3', 'SO2']
    );

    expect(coverage).toHaveLength(2);
    expect(coverage[0]?.pollutant_symbol).toBe('O3');
    expect(coverage[0]?.is_monitored).toBe(true);
    expect(coverage[0]?.latest_arithmetic_mean.status).toBe('unavailable');
    expect(coverage[1]?.pollutant_symbol).toBe('SO2');
    expect(coverage[1]?.is_monitored).toBe(false);
    expect(coverage[1]?.latest_arithmetic_mean.status).toBe('unavailable');
  });

  it('matches sites across state, county, cbsa, bounding_box, and point geographies', () => {
    const site = {
      site_id: '48-453-0014',
      state_fips: '48',
      county_fips: '48453',
      site_number: '0014',
      local_site_name: 'Austin Site',
      county_name: 'Travis',
      state_postal: 'TX',
      cbsa_code: '12420',
      latitude: 30.2672,
      longitude: -97.7431,
      datum: 'WGS84' as const,
      monitored_parameters: ['44201' as const],
    };

    expect(matchesSiteGeography(site, { level: 'state', state_fips: '48' })).toBe(true);
    expect(
      matchesSiteGeography(site, { level: 'county', county_fips: '48453', state_fips: '48' })
    ).toBe(true);
    expect(matchesSiteGeography(site, { level: 'cbsa', cbsa_code: '12420' })).toBe(true);
    expect(
      matchesSiteGeography(
        site,
        {
          level: 'point',
          latitude: 30.27,
          longitude: -97.74,
        },
        10
      )
    ).toBe(true);
    expect(
      matchesSiteGeography(
        site,
        {
          level: 'point',
          latitude: 34.05,
          longitude: -118.24,
        },
        50
      )
    ).toBe(false);
  });

  it('verifies epa-aqs source registry metadata has advanced to seed status', () => {
    const metadata = ECONOMIC_SOURCE_REGISTRY['epa-aqs'];
    expect(metadata.id).toBe('epa-aqs');
    expect(metadata.status).toBe('seed');
    expect(metadata.seed_fixture_id).toBe('epa-aqs-synthetic-v1');
  });
});
