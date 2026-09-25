import { describe, expect, it } from 'vitest';
import {
  BLS_LAU_DEFAULT_VINTAGE,
  BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER,
  type EconomicGeography,
} from '@gev/contracts';
import {
  BLS_LAU_PROVIDER_ID,
  BlsLauAdapter,
  BlsLauProviderDisabledError,
  BlsLauSeedModeViolationError,
  BlsRateLimitExceededError,
} from '../src/index.js';

describe('BLS LAU Provider Adapter (PLAN.md §10 Task 10.1 & ADR 0052)', () => {
  it('initializes in seed mode by default with valid dictionary and kill switch active', () => {
    const adapter = new BlsLauAdapter();
    expect(adapter.isEnabled()).toBe(true);
    expect(adapter.isSeedMode()).toBe(true);

    const dict = adapter.getVariableDictionary();
    expect(dict.version).toBe('1.0.0');
    expect(dict.program).toBe('lau');
    expect(dict.vintages_supported).toContain(BLS_LAU_DEFAULT_VINTAGE);

    expect(adapter.getMonthlyDisclaimer()).toBe(BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER);
  });

  it('queries BLS LAU estimates across county geography with measure and period filtering', async () => {
    const adapter = new BlsLauAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
      name: 'Travis County, TX',
    };

    const records = await adapter.query({
      geography: countyGeo,
      measures: ['03', '06'],
      period: 'M07',
    });

    expect(records.length).toBeGreaterThanOrEqual(2);

    const rate = records.find((r) => r.metric_id === 'unemployment-rate');
    expect(rate).toBeDefined();
    expect(rate?.estimate.status).toBe('available');
    if (rate?.estimate.status === 'available') {
      expect(rate.estimate.value).toBe(3.4);
      expect(rate.estimate.unit).toBe('percent');
    }

    const lf = records.find((r) => r.metric_id === 'civilian-labor-force');
    expect(lf).toBeDefined();
    expect(lf?.estimate.status).toBe('available');
    if (lf?.estimate.status === 'available') {
      expect(lf.estimate.value).toBe(812400);
      expect(lf.estimate.unit).toBe('count');
    }
  });

  it('supports convenience query methods for all 4 measures and monthly summary', async () => {
    const adapter = new BlsLauAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
      name: 'Travis County, TX',
    };

    const rateRec = await adapter.getUnemploymentRate(countyGeo, 'M07');
    expect(rateRec).toBeDefined();
    expect(rateRec?.estimate.status).toBe('available');
    if (rateRec?.estimate.status === 'available') {
      expect(rateRec.estimate.value).toBe(3.4);
    }

    const lfRec = await adapter.getLaborForce(countyGeo, 'M07');
    expect(lfRec).toBeDefined();
    if (lfRec?.estimate.status === 'available') {
      expect(lfRec.estimate.value).toBe(812400);
    }

    const empRec = await adapter.getEmployment(countyGeo, 'M07');
    expect(empRec).toBeDefined();
    if (empRec?.estimate.status === 'available') {
      expect(empRec.estimate.value).toBe(784800);
    }

    const unempRec = await adapter.getUnemployment(countyGeo, 'M07');
    expect(unempRec).toBeDefined();
    if (unempRec?.estimate.status === 'available') {
      expect(unempRec.estimate.value).toBe(27600);
    }

    const summary = await adapter.getMonthlySummary(countyGeo, 'M07');
    expect(summary.rate).toBeDefined();
    expect(summary.labor_force).toBeDefined();
    expect(summary.employed).toBeDefined();
    expect(summary.unemployed).toBeDefined();
  });

  it('filters by multiple periods (June vs July 2026)', async () => {
    const adapter = new BlsLauAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
      state_fips: '48',
    };

    const julyRate = await adapter.getUnemploymentRate(countyGeo, 'M07');
    expect(julyRate?.estimate.status).toBe('available');
    if (julyRate?.estimate.status === 'available') {
      expect(julyRate.estimate.value).toBe(3.4);
    }

    const juneRate = await adapter.getUnemploymentRate(countyGeo, 'M06');
    expect(juneRate?.estimate.status).toBe('available');
    if (juneRate?.estimate.status === 'available') {
      expect(juneRate.estimate.value).toBe(3.5);
    }
  });

  it('queries CBSA and State geographies', async () => {
    const adapter = new BlsLauAdapter();

    // CBSA
    const cbsaGeo: EconomicGeography = {
      level: 'cbsa',
      cbsa_code: '12420',
      name: 'Austin-Round Rock-Georgetown, TX',
    };
    const cbsaRate = await adapter.getUnemploymentRate(cbsaGeo, 'M07');
    expect(cbsaRate?.estimate.status).toBe('available');
    if (cbsaRate?.estimate.status === 'available') {
      expect(cbsaRate.estimate.value).toBe(3.6);
    }

    // State
    const stateGeo: EconomicGeography = {
      level: 'state',
      state_fips: '48',
      name: 'Texas',
    };
    const stateRate = await adapter.getUnemploymentRate(stateGeo, 'M07');
    expect(stateRate?.estimate.status).toBe('available');
    if (stateRate?.estimate.status === 'available') {
      expect(stateRate.estimate.value).toBe(4.1);
    }
  });

  it('strictly rejects any employee or applicant PII', async () => {
    const adapter = new BlsLauAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
    };

    await expect(
      adapter.query({
        geography: countyGeo,
        social_security_number: '123-45-6789',
      } as any)
    ).rejects.toThrow(/Prohibited employee\/applicant PII/);

    await expect(
      adapter.query({
        geography: countyGeo,
        applicant_name: 'Jane Doe',
      } as any)
    ).rejects.toThrow(/Prohibited employee\/applicant PII/);

    await expect(
      adapter.query({
        geography: countyGeo,
        phone: '555-123-4567',
      } as any)
    ).rejects.toThrow(/Prohibited employee\/applicant PII/);
  });

  it('enforces registered vs unregistered rate limits', async () => {
    const adapter = new BlsLauAdapter({ isRegistered: false });
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
    };

    // Unregistered query exceeding 10 series is rejected
    await expect(
      adapter.query({
        geography: countyGeo,
        variables: Array.from({ length: 11 }, (_, i) => `VAR_${i}`),
        is_registered: false,
      })
    ).rejects.toThrow(/exceeds BLS API limit of 10/);

    // Registered query allows more
    const registeredAdapter = new BlsLauAdapter({ isRegistered: true, apiKey: 'test-key' });
    const records = await registeredAdapter.query({
      geography: countyGeo,
      measures: ['03', '06'],
      is_registered: true,
    });
    expect(records.length).toBeGreaterThanOrEqual(2);
  });

  it('enforces strict seed mode and blocks unauthorized live calls', async () => {
    const liveAdapter = new BlsLauAdapter({
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
    ).rejects.toThrow(BlsLauSeedModeViolationError);
  });

  it('enforces kill switch when disabled (GEV_BLS_LAU_ENABLED=0)', async () => {
    const disabledAdapter = new BlsLauAdapter({ enabled: false });
    expect(disabledAdapter.isEnabled()).toBe(false);

    await expect(
      disabledAdapter.query({
        geography: {
          level: 'county',
          county_fips: '48453',
        },
      })
    ).rejects.toThrow(BlsLauProviderDisabledError);

    await expect(
      disabledAdapter.getEvidenceByGeography({
        level: 'county',
        county_fips: '48453',
      })
    ).rejects.toThrow(BlsLauProviderDisabledError);
  });

  it('performance threshold: parses and queries LAU dataset under 10ms p95 across 100 iterations', async () => {
    const adapter = new BlsLauAdapter();
    const countyGeo: EconomicGeography = {
      level: 'county',
      county_fips: '48453',
    };

    // Warm up
    await adapter.query({
      geography: countyGeo,
      measures: ['03', '06'],
    });

    const iterations = 100;
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await adapter.query({
        geography: countyGeo,
        measures: ['03', '04', '05', '06'],
        period: 'M07',
      });
      const end = performance.now();
      durations.push(end - start);
    }

    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(iterations * 0.5)];
    const p95 = durations[Math.floor(iterations * 0.95)];

    console.log(
      `[BENCHMARK] BLS LAU Query Latency (N=${iterations}): p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms`
    );

    expect(p95).toBeLessThan(10); // Required threshold: < 10ms p95 (and well under < 50ms)
  });
});
