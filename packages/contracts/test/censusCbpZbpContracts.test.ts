import { describe, expect, it } from 'vitest';
import {
  CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER,
  CENSUS_CBP_DEFAULT_VINTAGE,
  CENSUS_CBP_EMPLOYMENT_NOISE_BOUNDS,
  CENSUS_CBP_SCHEMA_VERSION,
  CensusCbpEmploymentNoiseFlagSchema,
  CensusCbpNaicsCodeSchema,
  CensusCbpQuerySchema,
  CensusCbpRawCellSchema,
  CensusCbpUnitSchema,
  CensusCbpVariableDefinitionSchema,
  CensusCbpVariableDictionarySchema,
  CensusCbpVariableIdSchema,
  CensusCbpVintageSchema,
} from '../src/index.js';

describe('Census CBP & ZBP Contracts (PLAN.md §10 Task 9.2 & ADR 0052)', () => {
  it('validates CBP variable identifiers and employment noise flags', () => {
    expect(CensusCbpVariableIdSchema.parse('ESTAB')).toBe('ESTAB');
    expect(CensusCbpVariableIdSchema.parse('EMP')).toBe('EMP');
    expect(CensusCbpVariableIdSchema.parse('PAYANN')).toBe('PAYANN');
    expect(CensusCbpVariableIdSchema.parse('PAYQTR1')).toBe('PAYQTR1');
    expect(() => CensusCbpVariableIdSchema.parse('INVALID')).toThrow();

    // Noise flags a through m
    const validFlags = ['a', 'b', 'c', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'];
    for (const flag of validFlags) {
      expect(CensusCbpEmploymentNoiseFlagSchema.parse(flag)).toBe(flag);
    }
    expect(() => CensusCbpEmploymentNoiseFlagSchema.parse('d')).toThrow(); // 'd' is not a CBP size flag
    expect(() => CensusCbpEmploymentNoiseFlagSchema.parse('z')).toThrow();
  });

  it('validates employment noise bounds table', () => {
    expect(CENSUS_CBP_EMPLOYMENT_NOISE_BOUNDS.a).toEqual({
      flag: 'a',
      lower_bound: 0,
      upper_bound: 19,
      description: '0 to 19 employees',
    });
    expect(CENSUS_CBP_EMPLOYMENT_NOISE_BOUNDS.c).toEqual({
      flag: 'c',
      lower_bound: 100,
      upper_bound: 249,
      description: '100 to 249 employees',
    });
    expect(CENSUS_CBP_EMPLOYMENT_NOISE_BOUNDS.m).toEqual({
      flag: 'm',
      lower_bound: 100000,
      description: '100,000 or more employees',
    });
  });

  it('validates NAICS codes and vintages', () => {
    expect(CensusCbpNaicsCodeSchema.parse('54')).toBe('54');
    expect(CensusCbpNaicsCodeSchema.parse('5415')).toBe('5415');
    expect(CensusCbpNaicsCodeSchema.parse('541511')).toBe('541511');
    expect(() => CensusCbpNaicsCodeSchema.parse('5')).toThrow(); // < 2 digits
    expect(() => CensusCbpNaicsCodeSchema.parse('5415111')).toThrow(); // > 6 digits
    expect(() => CensusCbpNaicsCodeSchema.parse('abc')).toThrow();

    expect(CensusCbpVintageSchema.parse('2023')).toBe('2023');
    expect(CensusCbpVintageSchema.parse('2023 CBP/ZBP Release')).toBe('2023 CBP/ZBP Release');
    expect(() => CensusCbpVintageSchema.parse('1999')).toThrow();
  });

  it('validates units, raw cells, and variable definitions/dictionary schema', () => {
    expect(CensusCbpUnitSchema.parse('count')).toBe('count');
    expect(CensusCbpUnitSchema.parse('USD_thousands')).toBe('USD_thousands');
    expect(CensusCbpRawCellSchema.parse('1420')).toBe('1420');
    expect(CensusCbpRawCellSchema.parse(null)).toBe(null);

    const varDef = CensusCbpVariableDefinitionSchema.parse({
      variable_id: 'ESTAB',
      metric_id: 'establishment-count',
      label: 'Total Establishments',
      statistical_definition:
        'Total number of establishments with active payroll in the reference year.',
      universe: 'Establishments with paid employees',
      unit: 'count',
      supported_geographies: ['nation', 'state', 'county', 'zcta', 'cbsa'],
      tags: ['cbp', 'establishments'],
    });
    expect(varDef.variable_id).toBe('ESTAB');

    const dictionary = CensusCbpVariableDictionarySchema.parse({
      schema_version: 1,
      version: '1.0.0',
      program: 'cbp_zbp',
      annual_disclaimer: CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER,
      vintages_supported: ['2023', '2022'],
      variables: {
        ESTAB: varDef,
      },
    });
    expect(dictionary.program).toBe('cbp_zbp');
  });

  it('validates mandatory annual statistical estimate disclaimer', () => {
    expect(CENSUS_CBP_SCHEMA_VERSION).toBe(1);
    expect(CENSUS_CBP_DEFAULT_VINTAGE).toBe('2023');
    expect(CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER).toContain(
      'annual statistical benchmark estimates'
    );
    expect(CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER).toContain(
      'not real-time operational headcounts'
    );
  });

  it('validates queries across county, ZCTA, CBSA, state, and nation', () => {
    const countyQuery = CensusCbpQuerySchema.parse({
      geography: {
        level: 'county',
        county_fips: '48453',
        state_fips: '48',
      },
      naics_code: '541511',
      variables: ['ESTAB', 'EMP', 'PAYANN'],
      vintage: '2023',
    });
    expect(countyQuery.geography.level).toBe('county');
    expect(countyQuery.naics_code).toBe('541511');

    const zctaQuery = CensusCbpQuerySchema.parse({
      geography: {
        level: 'zcta',
        zcta: '78701',
      },
      naics_code: '722511',
    });
    expect(zctaQuery.geography.level).toBe('zcta');

    const cbsaQuery = CensusCbpQuerySchema.parse({
      geography: {
        level: 'cbsa',
        cbsa_code: '12420',
      },
    });
    expect(cbsaQuery.geography.level).toBe('cbsa');
  });

  it('rejects unsupported geographies and malformed identifiers', () => {
    // Tract is unsupported for CBP/ZBP (CBP tabulates down to county, ZBP down to ZCTA)
    expect(() =>
      CensusCbpQuerySchema.parse({
        geography: {
          level: 'tract',
          tract_fips: '48453001100',
        },
      })
    ).toThrow(/CBP\/ZBP queries support geographies: county, zcta, state, nation, cbsa/);

    // Malformed county FIPS
    expect(() =>
      CensusCbpQuerySchema.parse({
        geography: {
          level: 'county',
          county_fips: '4845',
        },
      })
    ).toThrow();

    // Malformed NAICS
    expect(() =>
      CensusCbpQuerySchema.parse({
        geography: {
          level: 'county',
          county_fips: '48453',
        },
        naics_code: 'invalid',
      })
    ).toThrow();
  });
});
