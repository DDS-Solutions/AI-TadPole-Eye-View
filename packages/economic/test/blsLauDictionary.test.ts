import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BLS_LAU_DEFAULT_VINTAGE,
  BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER,
  BLS_LAU_VARIABLE_DICTIONARY_V1,
  BLS_LAU_VARIABLES_V1,
  buildLauSeriesId,
  getLauVariableOrThrow,
  lookupLauVariable,
  parseLauRawEstimate,
  parseLauSeriesId,
  validateLauGeography,
} from '../src/index.js';

describe('BLS LAU Dictionary, Series ID Builder & Zero-Coercion Parser (PLAN.md §10 Task 10.1 & ADR 0052)', () => {
  it('contains complete metadata for all 4 LAU measures', () => {
    expect(BLS_LAU_VARIABLE_DICTIONARY_V1.program).toBe('lau');
    expect(BLS_LAU_VARIABLE_DICTIONARY_V1.monthly_disclaimer).toBe(
      BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER
    );
    expect(BLS_LAU_VARIABLE_DICTIONARY_V1.vintages_supported).toContain(BLS_LAU_DEFAULT_VINTAGE);

    const rate = BLS_LAU_VARIABLES_V1.LAU_RATE;
    expect(rate.measure_code).toBe('03');
    expect(rate.metric_id).toBe('unemployment-rate');
    expect(rate.unit).toBe('percent');
    expect(rate.supported_geographies).toContain('county');
    expect(rate.supported_geographies).toContain('cbsa');

    const unemployed = BLS_LAU_VARIABLES_V1.LAU_UNEMPLOYED;
    expect(unemployed.measure_code).toBe('04');
    expect(unemployed.metric_id).toBe('unemployed-count');
    expect(unemployed.unit).toBe('count');

    const employed = BLS_LAU_VARIABLES_V1.LAU_EMPLOYED;
    expect(employed.measure_code).toBe('05');
    expect(employed.metric_id).toBe('employed-count');
    expect(employed.unit).toBe('count');

    const laborForce = BLS_LAU_VARIABLES_V1.LAU_LABOR_FORCE;
    expect(laborForce.measure_code).toBe('06');
    expect(laborForce.metric_id).toBe('civilian-labor-force');
    expect(laborForce.unit).toBe('count');
  });

  it('looks up variables by variable ID, measure code, or metric ID', () => {
    expect(lookupLauVariable('03')?.metric_id).toBe('unemployment-rate');
    expect(lookupLauVariable('LAU_RATE')?.measure_code).toBe('03');
    expect(lookupLauVariable('unemployment-rate')?.variable_id).toBe('LAU_RATE');

    expect(lookupLauVariable('06')?.metric_id).toBe('civilian-labor-force');
    expect(lookupLauVariable('civilian-labor-force')?.measure_code).toBe('06');

    expect(lookupLauVariable('04')?.metric_id).toBe('unemployed-count');
    expect(lookupLauVariable('05')?.metric_id).toBe('employed-count');

    expect(lookupLauVariable('99')).toBeUndefined();
    expect(() => getLauVariableOrThrow('99')).toThrow(
      /Unknown BLS LAU variable, measure, or metric identifier/
    );
  });

  it('validates geographies and fails closed on invalid formats or unsupported levels', () => {
    // Valid county
    expect(() =>
      validateLauGeography({
        level: 'county',
        county_fips: '48453',
        state_fips: '48',
        name: 'Travis County, TX',
      })
    ).not.toThrow();

    // Valid CBSA
    expect(() =>
      validateLauGeography({
        level: 'cbsa',
        cbsa_code: '12420',
        name: 'Austin-Round Rock-Georgetown, TX',
      })
    ).not.toThrow();

    // Valid state
    expect(() =>
      validateLauGeography({
        level: 'state',
        state_fips: '48',
      })
    ).not.toThrow();

    // Valid nation
    expect(() =>
      validateLauGeography({
        level: 'nation',
        country_code: 'US',
      })
    ).not.toThrow();

    // Invalid county FIPS (not 5 digits)
    expect(() =>
      validateLauGeography({
        level: 'county',
        county_fips: '4845',
      })
    ).toThrow(/invalid county FIPS/);

    // Unsupported level (e.g. zcta)
    expect(() =>
      validateLauGeography({
        level: 'zcta',
      } as unknown as EconomicGeography)
    ).toThrow(/Unsupported geography level/);
  });

  describe('BLS LAU Series ID Construction & Parsing', () => {
    it('builds canonical 17-character series IDs across all geography levels', () => {
      // County 48453 unemployment rate (03)
      const countyRateId = buildLauSeriesId({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
        measure: '03',
        seasonal: 'U',
      });
      expect(countyRateId).toBe('LAUCN484530000003');
      expect(countyRateId.length).toBe(17);

      // CBSA 12420 labor force (06)
      const cbsaLfId = buildLauSeriesId({
        geography: { level: 'cbsa', cbsa_code: '12420' },
        measure: '06',
        seasonal: 'U',
      });
      expect(cbsaLfId).toBe('LAUMT124200000006');
      expect(cbsaLfId.length).toBe(17);

      // State 48 employment (05)
      const stateEmpId = buildLauSeriesId({
        geography: { level: 'state', state_fips: '48' },
        measure: '05',
        seasonal: 'S',
      });
      expect(stateEmpId).toBe('LASST480000000005');
      expect(stateEmpId.length).toBe(17);

      // Nation unemployment (04)
      const nationUnempId = buildLauSeriesId({
        geography: { level: 'nation', country_code: 'US' },
        measure: '04',
        seasonal: 'U',
      });
      expect(nationUnempId).toBe('LAUUS000000000004');
      expect(nationUnempId.length).toBe(17);
    });

    it('round-trips series IDs through build and parse', () => {
      const seriesId = 'LAUCN484530000003';
      const parsed = parseLauSeriesId(seriesId);
      expect(parsed.seasonal).toBe('U');
      expect(parsed.area_type).toBe('CN');
      expect(parsed.area_code).toBe('4845300000');
      expect(parsed.measure_code).toBe('03');
    });

    it('property test: buildLauSeriesId and parseLauSeriesId maintain exact round-trip invariants', () => {
      const measures = ['03', '04', '05', '06'] as const;
      const seasonal = ['U', 'S'] as const;

      fc.assert(
        fc.property(
          fc.constantFrom(...measures),
          fc.constantFrom(...seasonal),
          fc.integer({ min: 10000, max: 99999 }).map(String),
          (measure, s, fips) => {
            const geo = {
              level: 'county' as const,
              county_fips: fips,
              state_fips: fips.slice(0, 2),
            };
            const built = buildLauSeriesId({ geography: geo, measure, seasonal: s });
            const parsed = parseLauSeriesId(built);

            expect(parsed.seasonal).toBe(s);
            expect(parsed.measure_code).toBe(measure);
            expect(parsed.area_type).toBe('CN');
            expect(parsed.area_code).toBe(`${fips}00000`);
          }
        )
      );
    });
  });

  describe('parseLauRawEstimate (zero numeric zero-coercion)', () => {
    it('parses valid numeric rates and counts', () => {
      const rate = parseLauRawEstimate(3.4, { unit: 'percent' });
      expect(rate.status).toBe('available');
      if (rate.status === 'available') {
        expect(rate.value).toBe(3.4);
        expect(rate.unit).toBe('percent');
      }

      const laborForce = parseLauRawEstimate('812400', { unit: 'count' });
      expect(laborForce.status).toBe('available');
      if (laborForce.status === 'available') {
        expect(laborForce.value).toBe(812400);
        expect(laborForce.unit).toBe('count');
      }
    });

    it('handles unavailable and suppressed indicators without coercion to 0', () => {
      expect(parseLauRawEstimate('-').status).toBe('unavailable');
      expect(parseLauRawEstimate('***').status).toBe('unavailable');
      expect(parseLauRawEstimate('N').status).toBe('unavailable');
      expect(parseLauRawEstimate(null).status).toBe('unavailable');

      const suppressed = parseLauRawEstimate('D', { unit: 'count' });
      expect(suppressed.status).toBe('suppressed');
      if (suppressed.status === 'suppressed') {
        expect(suppressed.reason).toBe('disclosure_avoidance');
      }
    });
  });
});
