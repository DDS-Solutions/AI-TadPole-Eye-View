import { describe, expect, it } from 'vitest';
import {
  BLS_API_LIMITS_REGISTERED,
  BLS_API_LIMITS_UNREGISTERED,
  BLS_LAU_DEFAULT_VINTAGE,
  BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER,
  BLS_LAU_SCHEMA_VERSION,
  BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER,
  BLS_OEWS_DEFAULT_VINTAGE,
  BLS_OEWS_SCHEMA_VERSION,
  BlsLauMeasureCodeSchema,
  BlsLauPeriodSchema,
  BlsLauQuerySchema,
  BlsLauSeasonalCodeSchema,
  BlsLauSeriesIdSchema,
  BlsLauUnitSchema,
  BlsLauVariableDefinitionSchema,
  BlsLauVariableDictionarySchema,
  BlsLauVariableIdSchema,
  BlsLauYearSchema,
  BlsOewsQuerySchema,
  BlsOewsUnitSchema,
  BlsOewsVariableDefinitionSchema,
  BlsOewsVariableDictionarySchema,
  BlsOewsVariableIdSchema,
  BlsOewsWageTypeSchema,
  BlsSocCodeSchema,
} from '../src/index.js';

describe('BLS OEWS & LAU Contracts (PLAN.md §10 Task 10.1 & ADR 0052)', () => {
  it('validates BLS SOC codes and variable identifiers', () => {
    expect(BlsSocCodeSchema.parse('15-1252')).toBe('15-1252');
    expect(BlsSocCodeSchema.parse('51-4041')).toBe('51-4041');
    expect(BlsSocCodeSchema.parse('00-0000')).toBe('00-0000');
    expect(() => BlsSocCodeSchema.parse('151252')).toThrow(); // missing hyphen
    expect(() => BlsSocCodeSchema.parse('15-125')).toThrow(); // incomplete
    expect(() => BlsSocCodeSchema.parse('SOC-1234')).toThrow();

    expect(BlsOewsVariableIdSchema.parse('TOT_EMP')).toBe('TOT_EMP');
    expect(BlsOewsVariableIdSchema.parse('A_MEDIAN')).toBe('A_MEDIAN');
    expect(BlsOewsVariableIdSchema.parse('H_MEAN')).toBe('H_MEAN');
    expect(BlsOewsVariableIdSchema.parse('H_PCT10')).toBe('H_PCT10');
    expect(BlsOewsVariableIdSchema.parse('A_PCT90')).toBe('A_PCT90');
    expect(() => BlsOewsVariableIdSchema.parse('UNKNOWN_VAR')).toThrow();

    expect(BlsOewsUnitSchema.parse('USD')).toBe('USD');
    expect(BlsOewsUnitSchema.parse('USD_per_hour')).toBe('USD_per_hour');
    expect(BlsOewsUnitSchema.parse('count')).toBe('count');
    expect(BlsOewsWageTypeSchema.parse('annual')).toBe('annual');
    expect(BlsOewsWageTypeSchema.parse('hourly')).toBe('hourly');
  });

  it('validates BLS OEWS variable definitions and dictionary contracts', () => {
    const varDef = BlsOewsVariableDefinitionSchema.parse({
      variable_id: 'A_MEDIAN',
      metric_id: 'annual-median-wage',
      label: 'Annual Median Wage',
      statistical_definition:
        '50th percentile annual wage estimate across non-farm wage and salary workers.',
      universe: 'Wage and salary workers in non-farm establishments',
      unit: 'USD',
      wage_type: 'annual',
      supported_geographies: ['cbsa', 'state', 'nation'],
      tags: ['oews', 'wages', 'annual', 'median'],
    });
    expect(varDef.variable_id).toBe('A_MEDIAN');

    const dictionary = BlsOewsVariableDictionarySchema.parse({
      schema_version: BLS_OEWS_SCHEMA_VERSION,
      version: '1.0.0',
      program: 'oews',
      annual_disclaimer: BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER,
      vintages_supported: [BLS_OEWS_DEFAULT_VINTAGE, 'May 2023'],
      variables: {
        A_MEDIAN: varDef,
      },
    });
    expect(dictionary.program).toBe('oews');
    expect(dictionary.annual_disclaimer).toContain('Occupational Employment and Wage Statistics');
  });

  it('validates BLS OEWS query schema with rate limits and anti-PII defense', () => {
    const validQuery = BlsOewsQuerySchema.parse({
      geography: {
        level: 'cbsa',
        cbsa_code: '12420',
        name: 'Austin-Round Rock-Georgetown, TX',
      },
      soc_code: '15-1252',
      variables: ['A_MEDIAN', 'H_MEAN'],
    });
    expect(validQuery.soc_code).toBe('15-1252');

    // Unsupported geography for OEWS (tract is not supported)
    expect(() =>
      BlsOewsQuerySchema.parse({
        geography: {
          level: 'tract',
          tract_fips: '48453000100',
        },
      })
    ).toThrow(/support geographies/);

    // Rate limit enforcement: unregistered max 10
    expect(() =>
      BlsOewsQuerySchema.parse({
        geography: { level: 'cbsa', cbsa_code: '12420' },
        variables: Array.from({ length: 11 }, (_, i) => `VAR_${i}`),
        is_registered: false,
      })
    ).toThrow(/exceeds BLS API limit of 10/);

    // Rate limit enforcement: registered allows up to 20
    const registeredQuery = BlsOewsQuerySchema.parse({
      geography: { level: 'cbsa', cbsa_code: '12420' },
      variables: Array.from({ length: 15 }, (_, i) => `VAR_${i}`),
      is_registered: true,
    });
    expect(registeredQuery.variables?.length).toBe(15);

    // Anti-PII verification: reject employee or applicant personal data
    expect(() =>
      BlsOewsQuerySchema.parse({
        geography: { level: 'cbsa', cbsa_code: '12420' },
        ssn: '000-00-0000',
      } as any)
    ).toThrow(/Prohibited employee\/applicant PII field/);

    expect(() =>
      BlsOewsQuerySchema.parse({
        geography: { level: 'cbsa', cbsa_code: '12420' },
        applicant_name: 'John Doe',
      } as any)
    ).toThrow(/Prohibited employee\/applicant PII field/);
  });

  it('validates BLS LAU measure codes, periods, and series ID contracts', () => {
    expect(BlsLauMeasureCodeSchema.parse('03')).toBe('03'); // Unemployment rate
    expect(BlsLauMeasureCodeSchema.parse('04')).toBe('04'); // Unemployed count
    expect(BlsLauMeasureCodeSchema.parse('05')).toBe('05'); // Employed count
    expect(BlsLauMeasureCodeSchema.parse('06')).toBe('06'); // Labor force
    expect(() => BlsLauMeasureCodeSchema.parse('01')).toThrow();

    expect(BlsLauVariableIdSchema.parse('LAU_RATE')).toBe('LAU_RATE');
    expect(BlsLauVariableIdSchema.parse('LAU_LABOR_FORCE')).toBe('LAU_LABOR_FORCE');

    // Periods
    expect(BlsLauPeriodSchema.parse('M01')).toBe('M01');
    expect(BlsLauPeriodSchema.parse('M07')).toBe('M07');
    expect(BlsLauPeriodSchema.parse('M12')).toBe('M12');
    expect(BlsLauPeriodSchema.parse('M13')).toBe('M13'); // Annual average
    expect(() => BlsLauPeriodSchema.parse('M00')).toThrow();
    expect(() => BlsLauPeriodSchema.parse('M14')).toThrow();
    expect(() => BlsLauPeriodSchema.parse('Q01')).toThrow();

    // Years
    expect(BlsLauYearSchema.parse('2026')).toBe('2026');
    expect(() => BlsLauYearSchema.parse('26')).toThrow();

    // Seasonal
    expect(BlsLauSeasonalCodeSchema.parse('U')).toBe('U');
    expect(BlsLauSeasonalCodeSchema.parse('S')).toBe('S');

    // Series ID format
    expect(BlsLauSeriesIdSchema.parse('LAUCN484530000000003')).toBe('LAUCN484530000000003');
    expect(() => BlsLauSeriesIdSchema.parse('INVALID_SERIES')).toThrow();
  });

  it('validates BLS LAU variable definitions and dictionary contracts', () => {
    const varDef = BlsLauVariableDefinitionSchema.parse({
      variable_id: 'LAU_RATE',
      measure_code: '03',
      metric_id: 'unemployment-rate',
      label: 'Unemployment Rate (Percent)',
      statistical_definition:
        'Civilian unemployment rate computed as (unemployed / labor_force) * 100.',
      universe: 'Civilian non-institutional population aged 16 and older',
      unit: 'percent',
      supported_geographies: ['county', 'cbsa', 'state', 'nation'],
      tags: ['lau', 'rate', 'unemployment'],
    });
    expect(varDef.measure_code).toBe('03');

    const dictionary = BlsLauVariableDictionarySchema.parse({
      schema_version: BLS_LAU_SCHEMA_VERSION,
      version: '1.0.0',
      program: 'lau',
      monthly_disclaimer: BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER,
      vintages_supported: [BLS_LAU_DEFAULT_VINTAGE, '2026-06'],
      variables: {
        LAU_RATE: varDef,
      },
    });
    expect(dictionary.program).toBe('lau');
    expect(dictionary.monthly_disclaimer).toContain('Local Area Unemployment Statistics');
  });

  it('validates BLS LAU query schema with rate limits and anti-PII defense', () => {
    const validQuery = BlsLauQuerySchema.parse({
      geography: {
        level: 'county',
        county_fips: '48453',
        state_fips: '48',
        name: 'Travis County, TX',
      },
      measures: ['03', '06'],
      period: 'M07',
      year: '2026',
    });
    expect(validQuery.geography.level).toBe('county');
    expect(validQuery.period).toBe('M07');

    // Unsupported geography for LAU (zcta is not supported by LAU)
    expect(() =>
      BlsLauQuerySchema.parse({
        geography: {
          level: 'zcta',
          zcta: '78701',
        },
      })
    ).toThrow(/support geographies/);

    // Anti-PII defense
    expect(() =>
      BlsLauQuerySchema.parse({
        geography: { level: 'county', county_fips: '48453' },
        candidate_id: 'cand_12345',
      } as any)
    ).toThrow(/Prohibited employee\/applicant PII field/);

    expect(() =>
      BlsLauQuerySchema.parse({
        geography: { level: 'county', county_fips: '48453' },
        email: 'worker@example.com',
      } as any)
    ).toThrow(/Prohibited employee\/applicant PII field/);
  });
});
