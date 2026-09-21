import { describe, expect, it } from 'vitest';
import {
  CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER,
  CENSUS_CBP_DEFAULT_VINTAGE,
  CENSUS_CBP_VARIABLE_DICTIONARY_V1,
  CENSUS_CBP_VARIABLES_V1,
  getCbpVariableOrThrow,
  getEmploymentNoiseBounds,
  lookupCbpVariable,
  parseCbpRawEstimate,
  validateCbpGeography,
  validateCbpNaicsCode,
} from '../src/index.js';

describe('Census CBP & ZBP Dictionary & Parser (PLAN.md §10 Task 9.2 & ADR 0052)', () => {
  it('contains complete metadata for ESTAB, EMP, PAYANN, and PAYQTR1', () => {
    expect(CENSUS_CBP_VARIABLE_DICTIONARY_V1.program).toBe('cbp_zbp');
    expect(CENSUS_CBP_VARIABLE_DICTIONARY_V1.annual_disclaimer).toBe(
      CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER
    );
    expect(CENSUS_CBP_VARIABLE_DICTIONARY_V1.vintages_supported).toContain(
      CENSUS_CBP_DEFAULT_VINTAGE
    );

    const estab = CENSUS_CBP_VARIABLES_V1.ESTAB;
    expect(estab.variable_id).toBe('ESTAB');
    expect(estab.metric_id).toBe('establishment-count');
    expect(estab.unit).toBe('count');
    expect(estab.supported_geographies).toContain('county');
    expect(estab.supported_geographies).toContain('zcta');

    const emp = CENSUS_CBP_VARIABLES_V1.EMP;
    expect(emp.variable_id).toBe('EMP');
    expect(emp.metric_id).toBe('paid-employment');
    expect(emp.unit).toBe('count');
    expect(emp.statistical_definition).toContain('13 U.S.C. Section 9');

    const payann = CENSUS_CBP_VARIABLES_V1.PAYANN;
    expect(payann.variable_id).toBe('PAYANN');
    expect(payann.metric_id).toBe('annual-payroll');
    expect(payann.unit).toBe('USD_thousands');

    const payqtr1 = CENSUS_CBP_VARIABLES_V1.PAYQTR1;
    expect(payqtr1.variable_id).toBe('PAYQTR1');
    expect(payqtr1.metric_id).toBe('first-quarter-payroll');
    expect(payqtr1.unit).toBe('USD_thousands');
  });

  it('looks up variables by variable ID or metric ID', () => {
    expect(lookupCbpVariable('ESTAB')?.metric_id).toBe('establishment-count');
    expect(lookupCbpVariable('establishment-count')?.variable_id).toBe('ESTAB');
    expect(lookupCbpVariable('EMP')?.metric_id).toBe('paid-employment');
    expect(lookupCbpVariable('paid-employment')?.variable_id).toBe('EMP');
    expect(lookupCbpVariable('PAYANN')?.metric_id).toBe('annual-payroll');
    expect(lookupCbpVariable('annual-payroll')?.variable_id).toBe('PAYANN');
    expect(lookupCbpVariable('PAYQTR1')?.metric_id).toBe('first-quarter-payroll');
    expect(lookupCbpVariable('first-quarter-payroll')?.variable_id).toBe('PAYQTR1');

    expect(lookupCbpVariable('UNKNOWN_ID')).toBeUndefined();
    expect(() => getCbpVariableOrThrow('UNKNOWN_ID')).toThrow(
      /Unknown Census CBP\/ZBP variable or metric identifier/
    );
  });

  it('validates geographies and fails closed on invalid formats or unsupported levels', () => {
    // Valid county
    expect(() =>
      validateCbpGeography({
        level: 'county',
        county_fips: '48453',
        state_fips: '48',
      })
    ).not.toThrow();

    // Valid zcta
    expect(() =>
      validateCbpGeography({
        level: 'zcta',
        zcta: '78701',
      })
    ).not.toThrow();

    // Valid cbsa
    expect(() =>
      validateCbpGeography({
        level: 'cbsa',
        cbsa_code: '12420',
      })
    ).not.toThrow();

    // Valid state
    expect(() =>
      validateCbpGeography({
        level: 'state',
        state_fips: '48',
      })
    ).not.toThrow();

    // Valid nation
    expect(() =>
      validateCbpGeography({
        level: 'nation',
        country_code: 'US',
      })
    ).not.toThrow();

    // County FIPS mismatch with state FIPS
    expect(() =>
      validateCbpGeography({
        level: 'county',
        county_fips: '48453',
        state_fips: '06',
      })
    ).toThrow(/does not match state FIPS/);

    // Invalid county FIPS length
    expect(() =>
      validateCbpGeography({
        level: 'county',
        county_fips: '4845',
      })
    ).toThrow(/invalid county FIPS/);

    // Invalid ZCTA length
    expect(() =>
      validateCbpGeography({
        level: 'zcta',
        zcta: '787',
      })
    ).toThrow(/invalid ZCTA/);

    // Invalid CBSA length
    expect(() =>
      validateCbpGeography({
        level: 'cbsa',
        cbsa_code: '124',
      })
    ).toThrow(/invalid CBSA code/);

    // Unsupported level (tract)
    expect(() =>
      validateCbpGeography({
        level: 'tract',
        tract_fips: '48453001100',
      } as unknown as Parameters<typeof validateCbpGeography>[0])
    ).toThrow(/Unsupported geography level 'tract'/);
  });

  it('validates NAICS codes between 2 and 6 numeric digits', () => {
    expect(() => validateCbpNaicsCode('54')).not.toThrow();
    expect(() => validateCbpNaicsCode('5415')).not.toThrow();
    expect(() => validateCbpNaicsCode('541511')).not.toThrow();

    expect(() => validateCbpNaicsCode('5')).toThrow(/Invalid NAICS code/);
    expect(() => validateCbpNaicsCode('5415111')).toThrow(/Invalid NAICS code/);
    expect(() => validateCbpNaicsCode('54A5')).toThrow(/Invalid NAICS code/);
  });

  it('retrieves employment noise bounds for flags a through m', () => {
    const flagA = getEmploymentNoiseBounds('a');
    expect(flagA.lower_bound).toBe(0);
    expect(flagA.upper_bound).toBe(19);

    const flagC = getEmploymentNoiseBounds('c');
    expect(flagC.lower_bound).toBe(100);
    expect(flagC.upper_bound).toBe(249);

    const flagM = getEmploymentNoiseBounds('m');
    expect(flagM.lower_bound).toBe(100000);
    expect(flagM.upper_bound).toBeUndefined();
  });

  describe('parseCbpRawEstimate (Zero numeric zero-coercion & suppression preservation)', () => {
    it('parses valid numeric estimates without zero coercion', () => {
      const res = parseCbpRawEstimate('1420', undefined, { unit: 'count' });
      expect(res.status).toBe('available');
      if (res.status === 'available') {
        expect(res.value).toBe(1420);
        expect(res.unit).toBe('count');
        expect(res.margin_of_error).toBeNull();
      }

      const payroll = parseCbpRawEstimate(3950000, undefined, { unit: 'USD_thousands' });
      expect(payroll.status).toBe('available');
      if (payroll.status === 'available') {
        expect(payroll.value).toBe(3950000);
        expect(payroll.unit).toBe('USD_thousands');
      }
    });

    it('preserves disclosure avoidance suppression with noise flag bounds (never coerces to 0)', () => {
      // Withheld 'D' with flag 'c'
      const withheldWithFlag = parseCbpRawEstimate('D', 'c', { unit: 'count' });
      expect(withheldWithFlag.status).toBe('suppressed');
      if (withheldWithFlag.status === 'suppressed') {
        expect(withheldWithFlag.reason).toBe('disclosure_avoidance');
        expect(withheldWithFlag.bounds?.lower_bound).toBe(100);
        expect(withheldWithFlag.bounds?.upper_bound).toBe(249);
        expect(withheldWithFlag.detail).toContain('13 U.S.C. Section 9');
      }

      // Value 0 with noise flag 'b' (placeholder 0 must NEVER be coerced to actual 0)
      const zeroWithFlag = parseCbpRawEstimate(0, 'b', { unit: 'count' });
      expect(zeroWithFlag.status).toBe('suppressed');
      if (zeroWithFlag.status === 'suppressed') {
        expect(zeroWithFlag.reason).toBe('disclosure_avoidance');
        expect(zeroWithFlag.bounds?.lower_bound).toBe(20);
        expect(zeroWithFlag.bounds?.upper_bound).toBe(99);
      }

      // Null with noise flag 'e'
      const nullWithFlag = parseCbpRawEstimate(null, 'e', { unit: 'count' });
      expect(nullWithFlag.status).toBe('suppressed');
      if (nullWithFlag.status === 'suppressed') {
        expect(nullWithFlag.reason).toBe('disclosure_avoidance');
        expect(nullWithFlag.bounds?.lower_bound).toBe(250);
        expect(nullWithFlag.bounds?.upper_bound).toBe(499);
      }
    });

    it('handles publication symbols D, S, and N correctly', () => {
      // D without noise flag (e.g. payroll withheld)
      const withheldPayroll = parseCbpRawEstimate('D', undefined, { unit: 'USD_thousands' });
      expect(withheldPayroll.status).toBe('suppressed');
      if (withheldPayroll.status === 'suppressed') {
        expect(withheldPayroll.reason).toBe('disclosure_avoidance');
        expect(withheldPayroll.bounds).toBeUndefined();
      }

      // S (publication standards quality suppression)
      const qualitySuppressed = parseCbpRawEstimate('S');
      expect(qualitySuppressed.status).toBe('suppressed');
      if (qualitySuppressed.status === 'suppressed') {
        expect(qualitySuppressed.reason).toBe('data_quality');
      }

      // N (not published / unavailable)
      const notPublished = parseCbpRawEstimate('N');
      expect(notPublished.status).toBe('unavailable');
    });

    it('handles missing or unparseable cells as unavailable', () => {
      expect(parseCbpRawEstimate(null).status).toBe('unavailable');
      expect(parseCbpRawEstimate('').status).toBe('unavailable');
      expect(parseCbpRawEstimate('not-a-number').status).toBe('unavailable');
    });
  });
});
