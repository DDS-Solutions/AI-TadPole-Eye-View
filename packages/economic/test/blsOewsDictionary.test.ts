import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER,
  BLS_OEWS_DEFAULT_VINTAGE,
  BLS_OEWS_VARIABLE_DICTIONARY_V1,
  BLS_OEWS_VARIABLES_V1,
  getOewsVariableOrThrow,
  lookupOewsVariable,
  parseOewsRawEstimate,
  validateOewsGeography,
  validateOewsSocCode,
} from '../src/index.js';

describe('BLS OEWS Dictionary & Zero-Coercion Parser (PLAN.md §10 Task 10.1 & ADR 0052)', () => {
  it('contains complete metadata for all core OEWS variables', () => {
    expect(BLS_OEWS_VARIABLE_DICTIONARY_V1.program).toBe('oews');
    expect(BLS_OEWS_VARIABLE_DICTIONARY_V1.annual_disclaimer).toBe(
      BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER
    );
    expect(BLS_OEWS_VARIABLE_DICTIONARY_V1.vintages_supported).toContain(BLS_OEWS_DEFAULT_VINTAGE);

    // Verify key variables exist
    const expectedVars = [
      'TOT_EMP',
      'EMP_PRSE',
      'H_MEAN',
      'A_MEAN',
      'H_PCT10',
      'H_PCT25',
      'H_MEDIAN',
      'H_PCT75',
      'H_PCT90',
      'A_PCT10',
      'A_PCT25',
      'A_MEDIAN',
      'A_PCT75',
      'A_PCT90',
    ];
    for (const v of expectedVars) {
      expect(BLS_OEWS_VARIABLES_V1[v]).toBeDefined();
      expect(BLS_OEWS_VARIABLES_V1[v].variable_id).toBe(v);
    }

    const aMedian = BLS_OEWS_VARIABLES_V1.A_MEDIAN;
    expect(aMedian.metric_id).toBe('annual-median-wage');
    expect(aMedian.unit).toBe('USD');
    expect(aMedian.wage_type).toBe('annual');
    expect(aMedian.supported_geographies).toContain('cbsa');
    expect(aMedian.supported_geographies).toContain('state');

    const hMean = BLS_OEWS_VARIABLES_V1.H_MEAN;
    expect(hMean.metric_id).toBe('mean-hourly-wage');
    expect(hMean.unit).toBe('USD_per_hour');
    expect(hMean.wage_type).toBe('hourly');

    const totEmp = BLS_OEWS_VARIABLES_V1.TOT_EMP;
    expect(totEmp.metric_id).toBe('total-employment');
    expect(totEmp.unit).toBe('count');
    expect(totEmp.wage_type).toBe('employment');
  });

  it('looks up variables by variable ID or metric ID', () => {
    expect(lookupOewsVariable('A_MEDIAN')?.metric_id).toBe('annual-median-wage');
    expect(lookupOewsVariable('annual-median-wage')?.variable_id).toBe('A_MEDIAN');
    expect(lookupOewsVariable('H_MEAN')?.metric_id).toBe('mean-hourly-wage');
    expect(lookupOewsVariable('mean-hourly-wage')?.variable_id).toBe('H_MEAN');
    expect(lookupOewsVariable('TOT_EMP')?.metric_id).toBe('total-employment');
    expect(lookupOewsVariable('total-employment')?.variable_id).toBe('TOT_EMP');

    expect(lookupOewsVariable('NON_EXISTENT')).toBeUndefined();
    expect(() => getOewsVariableOrThrow('NON_EXISTENT')).toThrow(
      /Unknown BLS OEWS variable or metric identifier/
    );
  });

  it('validates geographies and fails closed on invalid formats or unsupported levels', () => {
    // Valid CBSA
    expect(() =>
      validateOewsGeography({
        level: 'cbsa',
        cbsa_code: '12420',
        name: 'Austin-Round Rock-Georgetown, TX',
      })
    ).not.toThrow();

    // Valid state
    expect(() =>
      validateOewsGeography({
        level: 'state',
        state_fips: '48',
        name: 'Texas',
      })
    ).not.toThrow();

    // Valid nation
    expect(() =>
      validateOewsGeography({
        level: 'nation',
        country_code: 'US',
        name: 'United States',
      })
    ).not.toThrow();

    // Valid county
    expect(() =>
      validateOewsGeography({
        level: 'county',
        county_fips: '48453',
        state_fips: '48',
        name: 'Travis County, TX',
      })
    ).not.toThrow();

    // Invalid CBSA code (not 5 digits)
    expect(() =>
      validateOewsGeography({
        level: 'cbsa',
        cbsa_code: '1242',
      })
    ).toThrow(/invalid CBSA code/);

    // Invalid state FIPS (not 2 digits)
    expect(() =>
      validateOewsGeography({
        level: 'state',
        state_fips: '4',
      })
    ).toThrow(/invalid state FIPS/);

    // County state mismatch
    expect(() =>
      validateOewsGeography({
        level: 'county',
        county_fips: '48453',
        state_fips: '06',
      })
    ).toThrow(/does not match state FIPS/);

    // Unsupported level (e.g. tract)
    expect(() =>
      validateOewsGeography({
        level: 'tract',
      } as unknown as EconomicGeography)
    ).toThrow(/Unsupported geography level/);
  });

  it('validates standard SOC codes (format XX-XXXX)', () => {
    expect(() => validateOewsSocCode('15-1252')).not.toThrow();
    expect(() => validateOewsSocCode('51-4041')).not.toThrow();
    expect(() => validateOewsSocCode('00-0000')).not.toThrow();

    expect(() => validateOewsSocCode('151252')).toThrow();
    expect(() => validateOewsSocCode('15-125')).toThrow();
    expect(() => validateOewsSocCode('invalid')).toThrow();
  });

  describe('parseOewsRawEstimate (zero numeric zero-coercion)', () => {
    it('parses valid numeric estimates without mutating value', () => {
      const annualWage = parseOewsRawEstimate(138500, { unit: 'USD' });
      expect(annualWage.status).toBe('available');
      if (annualWage.status === 'available') {
        expect(annualWage.value).toBe(138500);
        expect(annualWage.unit).toBe('USD');
        expect(annualWage.margin_of_error).toBeNull();
      }

      const hourlyWage = parseOewsRawEstimate('68.75', { unit: 'USD_per_hour' });
      expect(hourlyWage.status).toBe('available');
      if (hourlyWage.status === 'available') {
        expect(hourlyWage.value).toBe(68.75);
        expect(hourlyWage.unit).toBe('USD_per_hour');
      }

      const headcount = parseOewsRawEstimate(34200, { unit: 'count' });
      expect(headcount.status).toBe('available');
      if (headcount.status === 'available') {
        expect(headcount.value).toBe(34200);
        expect(headcount.unit).toBe('count');
      }
    });

    it('preserves top-coded wage suppression (* and (1)) with explicit lower bounds (never coerces to 0)', () => {
      // Annual top-code
      const annualTopCoded = parseOewsRawEstimate('*', { unit: 'USD' });
      expect(annualTopCoded.status).toBe('suppressed');
      if (annualTopCoded.status === 'suppressed') {
        expect(annualTopCoded.reason).toBe('disclosure_avoidance');
        expect(annualTopCoded.bounds?.lower_bound).toBe(239200);
        expect(annualTopCoded.detail).toContain('equals or exceeds $239,200 per year');
      }

      // Hourly top-code
      const hourlyTopCoded = parseOewsRawEstimate('(1)', { unit: 'USD_per_hour' });
      expect(hourlyTopCoded.status).toBe('suppressed');
      if (hourlyTopCoded.status === 'suppressed') {
        expect(hourlyTopCoded.reason).toBe('disclosure_avoidance');
        expect(hourlyTopCoded.bounds?.lower_bound).toBe(115);
        expect(hourlyTopCoded.detail).toContain('equals or exceeds $115 per hour');
      }
    });

    it('preserves data quality reliability suppression (** and (2)) when RSE > 50%', () => {
      const dataQuality = parseOewsRawEstimate('**', { unit: 'USD' });
      expect(dataQuality.status).toBe('suppressed');
      if (dataQuality.status === 'suppressed') {
        expect(dataQuality.reason).toBe('data_quality');
        expect(dataQuality.detail).toContain(
          'relative standard error (RSE) exceeds reliability threshold of 50%'
        );
      }

      const dataQuality2 = parseOewsRawEstimate('(2)', { unit: 'USD_per_hour' });
      expect(dataQuality2.status).toBe('suppressed');
      if (dataQuality2.status === 'suppressed') {
        expect(dataQuality2.reason).toBe('data_quality');
      }
    });

    it('preserves confidentiality suppression ((8) and D)', () => {
      const confidential = parseOewsRawEstimate('(8)', { unit: 'USD' });
      expect(confidential.status).toBe('suppressed');
      if (confidential.status === 'suppressed') {
        expect(confidential.reason).toBe('disclosure_avoidance');
        expect(confidential.detail).toContain(
          'withheld to avoid disclosing operations of individual employers'
        );
      }

      const confidentialD = parseOewsRawEstimate('D', { unit: 'count' });
      expect(confidentialD.status).toBe('suppressed');
      if (confidentialD.status === 'suppressed') {
        expect(confidentialD.reason).toBe('disclosure_avoidance');
      }
    });

    it('handles unavailable symbols (***, (3), -, N) as unavailable without throwing', () => {
      expect(parseOewsRawEstimate('***').status).toBe('unavailable');
      expect(parseOewsRawEstimate('(3)').status).toBe('unavailable');
      expect(parseOewsRawEstimate('-').status).toBe('unavailable');
      expect(parseOewsRawEstimate('N').status).toBe('unavailable');
      expect(parseOewsRawEstimate(null).status).toBe('unavailable');
      expect(parseOewsRawEstimate(undefined).status).toBe('unavailable');
      expect(parseOewsRawEstimate('').status).toBe('unavailable');
      expect(parseOewsRawEstimate('not-numeric').status).toBe('unavailable');
    });

    it('property test: non-negative numbers always parse to available status with exact value', () => {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 1_000_000, noNaN: true }), (val) => {
          const parsed = parseOewsRawEstimate(val, { unit: 'USD' });
          expect(parsed.status).toBe('available');
          if (parsed.status === 'available') {
            expect(parsed.value).toBe(val);
            expect(parsed.unit).toBe('USD');
          }
        })
      );
    });
  });
});
