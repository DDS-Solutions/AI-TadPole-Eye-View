import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CENSUS_ACS_FOREIGN_BORN_STATUTORY_DEFINITION } from '@gev/contracts';
import {
  CENSUS_ACS_VARIABLE_DICTIONARY_V1,
  CENSUS_ACS_VARIABLES_V1,
  getAcsVariableOrThrow,
  isAcsGeographySupported,
  lookupAcsVariable,
  parseAcsRawEstimate,
  validateAcsGeography,
} from '../src/index.js';

describe('Census ACS Variable Dictionary & Pure Domain (Task 9.1 & ADR 0052)', () => {
  it('validates CENSUS_ACS_VARIABLE_DICTIONARY_V1 integrity', () => {
    expect(CENSUS_ACS_VARIABLE_DICTIONARY_V1.version).toBe('1.0.0');
    expect(CENSUS_ACS_VARIABLE_DICTIONARY_V1.acs_release).toBe('acs5');
    expect(CENSUS_ACS_VARIABLE_DICTIONARY_V1.vintages_supported).toContain('2020-2024');

    // Verify presence of all required benchmark variables
    const varKeys = Object.keys(CENSUS_ACS_VARIABLES_V1);
    expect(varKeys).toContain('B01003_001E'); // Total population
    expect(varKeys).toContain('B19013_001E'); // Median household income
    expect(varKeys).toContain('B05002_003E'); // Foreign-born population
    expect(varKeys).toContain('B25077_001E'); // Median housing value
    expect(varKeys).toContain('B25064_001E'); // Median gross rent
    expect(varKeys).toContain('B19001_017E'); // Specialized high-income bracket
    expect(varKeys).toContain('B15003_022E'); // Educational attainment: Bachelor's
    expect(varKeys).toContain('B08301_001E'); // Commuting workers
    expect(varKeys).toContain('B23025_005E'); // Civilian unemployed
    expect(varKeys).toContain('B17001_002E'); // Poverty count
  });

  it('verifies statutory foreign-born population definition (Table B05002)', () => {
    const foreignBorn = lookupAcsVariable('B05002_003E');
    expect(foreignBorn).toBeDefined();
    expect(foreignBorn?.table_id).toBe('B05002');
    expect(foreignBorn?.metric_id).toBe('foreign-born-population');
    expect(foreignBorn?.statistical_definition).toBe(CENSUS_ACS_FOREIGN_BORN_STATUTORY_DEFINITION);

    // Statutory rule: must explicitly include both naturalized citizens and non-citizens
    const def = foreignBorn?.statistical_definition.toLowerCase();
    expect(def).toContain('naturalized');
    expect(def).toContain('non-citizen');
    expect(def).not.toBe('non-citizens only');
  });

  it('supports variable lookup by variable ID and by metric ID', () => {
    const byId = lookupAcsVariable('B19013_001E');
    const byMetric = lookupAcsVariable('median-household-income');

    expect(byId).toBeDefined();
    expect(byMetric).toBeDefined();
    expect(byId?.variable_id).toBe(byMetric?.variable_id);

    expect(getAcsVariableOrThrow('total-population').variable_id).toBe('B01003_001E');
    expect(() => getAcsVariableOrThrow('non-existent-variable')).toThrow(
      /Unknown Census ACS variable or metric identifier/
    );
  });

  it('verifies geography support check across levels', () => {
    const income = getAcsVariableOrThrow('median-household-income');
    expect(isAcsGeographySupported(income, 'county')).toBe(true);
    expect(isAcsGeographySupported(income, 'tract')).toBe(true);
    expect(isAcsGeographySupported(income, 'zcta')).toBe(true);
    expect(isAcsGeographySupported(income, 'place')).toBe(true);
    expect(isAcsGeographySupported(income, 'state')).toBe(true);
    expect(isAcsGeographySupported(income, 'nation')).toBe(true);
  });

  it('validates valid Census ACS geographies and rejects malformed FIPS codes', () => {
    // Valid cases
    expect(() =>
      validateAcsGeography({
        level: 'county',
        county_fips: '48453',
        state_fips: '48',
        name: 'Travis County, TX',
      })
    ).not.toThrow();

    expect(() =>
      validateAcsGeography({
        level: 'tract',
        tract_fips: '48453001100',
        name: 'Tract 11',
      })
    ).not.toThrow();

    expect(() =>
      validateAcsGeography({
        level: 'zcta',
        zcta: '78701',
      })
    ).not.toThrow();

    expect(() =>
      validateAcsGeography({
        level: 'place',
        place_fips: '4805000',
      })
    ).not.toThrow();

    expect(() =>
      validateAcsGeography({
        level: 'state',
        state_fips: '48',
      })
    ).not.toThrow();

    expect(() =>
      validateAcsGeography({
        level: 'nation',
        country_code: 'US',
      })
    ).not.toThrow();

    // Invalid county FIPS (length != 5 or state mismatch)
    expect(() =>
      validateAcsGeography({
        level: 'county',
        county_fips: '1234', // 4 digits
      })
    ).toThrow(/invalid county FIPS/);

    expect(() =>
      validateAcsGeography({
        level: 'county',
        county_fips: '48453',
        state_fips: '06', // Mismatch!
      })
    ).toThrow(/does not match state FIPS/);

    // Invalid tract FIPS (length != 11)
    expect(() =>
      validateAcsGeography({
        level: 'tract',
        tract_fips: '48453001', // 8 digits
      })
    ).toThrow(/invalid tract FIPS/);

    // Invalid ZCTA (length != 5)
    expect(() =>
      validateAcsGeography({
        level: 'zcta',
        zcta: '787',
      })
    ).toThrow(/invalid ZCTA/);

    // Invalid Place FIPS (length != 7)
    expect(() =>
      validateAcsGeography({
        level: 'place',
        place_fips: '48050',
      })
    ).toThrow(/invalid place FIPS/);

    // Unsupported geography
    expect(() =>
      validateAcsGeography({
        level: 'point',
        latitude: 30.2672,
        longitude: -97.7431,
      })
    ).toThrow(/Unsupported geography level 'point'/);
  });

  describe('parseAcsRawEstimate: zero non-coercion & suppression handling', () => {
    it('parses valid numeric estimates with margin of error at 90% confidence', () => {
      const estimate = parseAcsRawEstimate('92450', '1850', { unit: 'USD' });
      expect(estimate.status).toBe('available');
      if (estimate.status === 'available') {
        expect(estimate.value).toBe(92450);
        expect(estimate.margin_of_error).toBe(1850);
        expect(estimate.confidence_level).toBe(0.9);
        expect(estimate.unit).toBe('USD');
      }
    });

    it('handles negative MOE special code (-555555555 controlled estimate) as null MOE', () => {
      const estimate = parseAcsRawEstimate('1250000', '-555555555', { unit: 'count' });
      expect(estimate.status).toBe('available');
      if (estimate.status === 'available') {
        expect(estimate.value).toBe(1250000);
        expect(estimate.margin_of_error).toBeNull();
        expect(estimate.confidence_level).toBe(0.9);
      }
    });

    it('maps Census Bureau -666666666 to suppressed (reason: small_sample) without zero coercion', () => {
      const estimate = parseAcsRawEstimate('-666666666', '0', { unit: 'USD' });
      expect(estimate.status).toBe('suppressed');
      if (estimate.status === 'suppressed') {
        expect(estimate.reason).toBe('small_sample');
        expect(estimate.detail.toLowerCase()).toContain('sample');
        expect(estimate.unit).toBe('USD');
      }
    });

    it('maps Census Bureau -888888888 to unavailable without zero coercion', () => {
      const estimate = parseAcsRawEstimate('-888888888', null);
      expect(estimate.status).toBe('unavailable');
      if (estimate.status === 'unavailable') {
        expect(estimate.reason).toContain('not applicable or not available');
      }
    });

    it('maps Census Bureau -999999999 to suppressed (reason: data_quality) without zero coercion', () => {
      const estimate = parseAcsRawEstimate('-999999999', '100', { unit: 'USD' });
      expect(estimate.status).toBe('suppressed');
      if (estimate.status === 'suppressed') {
        expect(estimate.reason).toBe('data_quality');
      }
    });

    it('maps null, undefined, and empty strings to unavailable without zero coercion', () => {
      expect(parseAcsRawEstimate(null).status).toBe('unavailable');
      expect(parseAcsRawEstimate(undefined).status).toBe('unavailable');
      expect(parseAcsRawEstimate('').status).toBe('unavailable');
      expect(parseAcsRawEstimate('not-a-number').status).toBe('unavailable');
    });

    it('property test: parseAcsRawEstimate never coerces suppressed/unavailable to numeric zero', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('-666666666', '-888888888', '-999999999', null, undefined, ''),
          fc.option(fc.string()),
          (rawVal, rawMoe) => {
            const estimate = parseAcsRawEstimate(rawVal, rawMoe);
            expect(estimate.status).not.toBe('available');
            expect(estimate.status).toMatch(/suppressed|unavailable/);
          }
        )
      );
    });

    it('property test: valid numeric strings produce available estimates with exact values', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1_000_000_000 }),
          fc.integer({ min: 0, max: 10_000_000 }),
          (val, moe) => {
            const estimate = parseAcsRawEstimate(String(val), String(moe));
            expect(estimate.status).toBe('available');
            if (estimate.status === 'available') {
              expect(estimate.value).toBe(val);
              expect(estimate.margin_of_error).toBe(moe);
              expect(estimate.confidence_level).toBe(0.9);
            }
          }
        )
      );
    });
  });
});
