import { describe, expect, it } from 'vitest';
import {
  CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER,
  CENSUS_CBP_DEFAULT_VINTAGE,
  type EconomicGeography,
} from '@gev/contracts';
import {
  CensusCbpInvalidQueryError,
  CensusCbpProviderDisabledError,
  CensusCbpSeedModeViolationError,
  CensusCbpZbpAdapter,
} from '../src/index.js';

describe('Census CBP & ZBP Provider Adapter (PLAN.md §10 Task 9.2 & ADR 0052)', () => {
  it('initializes in seed mode by default with valid dictionary and kill switch active', () => {
    const adapter = new CensusCbpZbpAdapter();
    expect(adapter.isEnabled()).toBe(true);
    expect(adapter.isSeedMode()).toBe(true);

    const dict = adapter.getVariableDictionary();
    expect(dict.version).toBe('1.0.0');
    expect(dict.program).toBe('cbp_zbp');
    expect(dict.vintages_supported).toContain(CENSUS_CBP_DEFAULT_VINTAGE);

    expect(adapter.getAnnualDisclaimer()).toBe(CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER);
  });

  it('queries Census CBP estimates across county geography with NAICS filtering', async () => {
    const adapter = new CensusCbpZbpAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
      name: 'Travis County, TX',
    };

    const records = await adapter.query({
      geography: countyGeo,
      naics_code: '541511',
      variables: ['ESTAB', 'EMP', 'PAYANN', 'PAYQTR1'],
      vintage: CENSUS_CBP_DEFAULT_VINTAGE,
    });

    expect(records.length).toBe(4);

    const estab = records.find((r) => r.variable_name === 'ESTAB');
    expect(estab).toBeDefined();
    expect(estab?.estimate.status).toBe('available');
    if (estab?.estimate.status === 'available') {
      expect(estab.estimate.value).toBe(1420);
      expect(estab.estimate.unit).toBe('count');
      expect(estab.estimate.margin_of_error).toBeNull();
    }

    const emp = records.find((r) => r.variable_name === 'EMP');
    expect(emp).toBeDefined();
    expect(emp?.estimate.status).toBe('available');
    if (emp?.estimate.status === 'available') {
      expect(emp.estimate.value).toBe(28400);
      expect(emp.estimate.unit).toBe('count');
    }

    const payann = records.find((r) => r.variable_name === 'PAYANN');
    expect(payann).toBeDefined();
    expect(payann?.estimate.status).toBe('available');
    if (payann?.estimate.status === 'available') {
      expect(payann.estimate.value).toBe(3950000);
      expect(payann.estimate.unit).toBe('USD_thousands');
    }

    const payqtr1 = records.find((r) => r.variable_name === 'PAYQTR1');
    expect(payqtr1).toBeDefined();
    expect(payqtr1?.estimate.status).toBe('available');
    if (payqtr1?.estimate.status === 'available') {
      expect(payqtr1.estimate.value).toBe(980000);
      expect(payqtr1.estimate.unit).toBe('USD_thousands');
    }
  });

  it('preserves statutory disclosure avoidance suppression under 13 U.S.C. Section 9 without zero coercion', async () => {
    const adapter = new CensusCbpZbpAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
      name: 'Travis County, TX',
    };

    const records = await adapter.query({
      geography: countyGeo,
      naics_code: '332710',
    });

    expect(records.length).toBe(2);

    const suppressedEmp = records.find((r) => r.variable_name === 'EMP');
    expect(suppressedEmp).toBeDefined();
    expect(suppressedEmp?.estimate.status).toBe('suppressed');
    if (suppressedEmp?.estimate.status === 'suppressed') {
      expect(suppressedEmp.estimate.reason).toBe('disclosure_avoidance');
      expect(suppressedEmp.estimate.bounds?.lower_bound).toBe(100);
      expect(suppressedEmp.estimate.bounds?.upper_bound).toBe(249);
      expect(suppressedEmp.estimate.detail).toContain('13 U.S.C. Section 9');
      expect(suppressedEmp.estimate.detail).toContain('noise flag c');
    }

    const suppressedPay = records.find((r) => r.variable_name === 'PAYANN');
    expect(suppressedPay).toBeDefined();
    expect(suppressedPay?.estimate.status).toBe('suppressed');
    if (suppressedPay?.estimate.status === 'suppressed') {
      expect(suppressedPay.estimate.reason).toBe('disclosure_avoidance');
      expect(suppressedPay.estimate.detail).toContain('withheld to avoid disclosing');
    }
  });

  it('queries Census ZBP estimates across ZCTA geography', async () => {
    const adapter = new CensusCbpZbpAdapter();
    const zctaGeo: EconomicGeography = {
      level: 'zcta',
      zcta: '78701',
      name: 'ZCTA 78701 (Austin Downtown, TX)',
    };

    const records = await adapter.query({
      geography: zctaGeo,
      naics_code: '722511',
    });

    expect(records.length).toBe(4); // ESTAB, EMP, PAYANN, PAYQTR1

    const estab = records.find((r) => r.variable_name === 'ESTAB');
    expect(estab).toBeDefined();
    expect(estab?.estimate.status).toBe('available');
    if (estab?.estimate.status === 'available') {
      expect(estab.estimate.value).toBe(84);
    }

    const emp = records.find((r) => r.variable_name === 'EMP');
    expect(emp).toBeDefined();
    if (emp?.estimate.status === 'available') {
      expect(emp.estimate.value).toBe(1250);
    }

    const payann = records.find((r) => r.variable_name === 'PAYANN');
    expect(payann).toBeDefined();
    if (payann?.estimate.status === 'available') {
      expect(payann.estimate.value).toBe(42000);
    }

    const payqtr1 = records.find((r) => r.variable_name === 'PAYQTR1');
    expect(payqtr1).toBeDefined();
    if (payqtr1?.estimate.status === 'available') {
      expect(payqtr1.estimate.value).toBe(10500);
    }
  });

  it('supports convenience methods for establishments, employment, and payroll', async () => {
    const adapter = new CensusCbpZbpAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
    };

    const establishments = await adapter.getEstablishments(countyGeo, '541511');
    expect(establishments.length).toBe(1);
    expect(establishments[0].variable_name).toBe('ESTAB');

    const employment = await adapter.getPaidEmployment(countyGeo, '541511');
    expect(employment.length).toBe(1);
    expect(employment[0].variable_name).toBe('EMP');

    const payroll = await adapter.getPayroll(countyGeo, '541511');
    expect(payroll.length).toBe(2); // PAYANN and PAYQTR1
    expect(payroll.some((r) => r.variable_name === 'PAYANN')).toBe(true);
    expect(payroll.some((r) => r.variable_name === 'PAYQTR1')).toBe(true);

    const naicsRecords = await adapter.getEvidenceByNaics(countyGeo, '332710');
    expect(naicsRecords.length).toBe(2);

    const allGeoRecords = await adapter.getEvidenceByGeography(countyGeo);
    expect(allGeoRecords.length).toBeGreaterThanOrEqual(6);
  });

  it('fails closed immediately on malformed FIPS codes, NAICS codes, or state mismatches', async () => {
    const adapter = new CensusCbpZbpAdapter();

    // 4-digit county FIPS
    await expect(
      adapter.query({
        geography: {
          level: 'county',
          county_fips: '4845',
        },
      })
    ).rejects.toThrow();

    // State mismatch
    await expect(
      adapter.query({
        geography: {
          level: 'county',
          county_fips: '48453',
          state_fips: '06',
        },
      })
    ).rejects.toThrow();

    // Unsupported level (tract)
    await expect(
      adapter.query({
        geography: {
          level: 'tract',
          tract_fips: '48453001100',
        } as unknown as Parameters<typeof adapter.query>[0]['geography'],
      })
    ).rejects.toThrow(/CBP\/ZBP queries support geographies: county, zcta, state, nation, cbsa/);

    // Malformed NAICS code (letters)
    await expect(
      adapter.query({
        geography: {
          level: 'county',
          county_fips: '48453',
        },
        naics_code: 'ABC',
      })
    ).rejects.toThrow();
  });

  it('fails closed immediately on unsupported vintage', async () => {
    const adapter = new CensusCbpZbpAdapter();
    await expect(
      adapter.query({
        geography: {
          level: 'county',
          county_fips: '48453',
        },
        vintage: '2015', // Unsupported
      })
    ).rejects.toThrow(CensusCbpInvalidQueryError);
  });

  it('enforces strict seed mode and blocks unauthorized live calls', async () => {
    const liveAdapter = new CensusCbpZbpAdapter({
      seedMode: false,
      allowLiveCalls: false,
    });

    await expect(
      liveAdapter.query({
        geography: {
          level: 'county',
          county_fips: '48453',
        },
      })
    ).rejects.toThrow(CensusCbpSeedModeViolationError);
  });

  it('enforces kill switch when disabled (GEV_CENSUS_CBP_ENABLED=0)', async () => {
    const disabledAdapter = new CensusCbpZbpAdapter({ enabled: false });
    expect(disabledAdapter.isEnabled()).toBe(false);

    await expect(
      disabledAdapter.query({
        geography: {
          level: 'county',
          county_fips: '48453',
        },
      })
    ).rejects.toThrow(CensusCbpProviderDisabledError);

    await expect(
      disabledAdapter.getEvidenceByGeography({
        level: 'county',
        county_fips: '48453',
      })
    ).rejects.toThrow(CensusCbpProviderDisabledError);
  });

  it('performance threshold: parses and queries CBP/ZBP dataset under 10ms p95 across 100 iterations', async () => {
    const adapter = new CensusCbpZbpAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
    };

    // Warm up
    await adapter.query({
      geography: countyGeo,
      naics_code: '541511',
    });

    const iterations = 100;
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await adapter.query({
        geography: countyGeo,
        naics_code: '541511',
        variables: ['ESTAB', 'EMP', 'PAYANN', 'PAYQTR1'],
      });
      const end = performance.now();
      durations.push(end - start);
    }

    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(iterations * 0.5)];
    const p95 = durations[Math.floor(iterations * 0.95)];

    console.log(
      `[BENCHMARK] Census CBP/ZBP Query Latency (N=${iterations}): p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms`
    );

    expect(p95).toBeLessThan(10); // Required threshold: < 10ms p95
  });
});
