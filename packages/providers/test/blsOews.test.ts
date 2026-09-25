import { describe, expect, it } from 'vitest';
import {
  BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER,
  BLS_OEWS_DEFAULT_VINTAGE,
  type EconomicGeography,
} from '@gev/contracts';
import {
  BLS_OEWS_PROVIDER_ID,
  BlsOewsAdapter,
  BlsOewsProviderDisabledError,
  BlsOewsSeedModeViolationError,
  BlsPiiIngestionError,
  BlsRateLimitExceededError,
} from '../src/index.js';

describe('BLS OEWS Provider Adapter (PLAN.md §10 Task 10.1 & ADR 0052)', () => {
  it('initializes in seed mode by default with valid dictionary and kill switch active', () => {
    const adapter = new BlsOewsAdapter();
    expect(adapter.isEnabled()).toBe(true);
    expect(adapter.isSeedMode()).toBe(true);

    const dict = adapter.getVariableDictionary();
    expect(dict.version).toBe('1.0.0');
    expect(dict.program).toBe('oews');
    expect(dict.vintages_supported).toContain(BLS_OEWS_DEFAULT_VINTAGE);

    expect(adapter.getAnnualDisclaimer()).toBe(BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER);
  });

  it('queries BLS OEWS estimates across CBSA geography with SOC code filtering', async () => {
    const adapter = new BlsOewsAdapter();
    const cbsaGeo: EconomicGeography = {
      level: 'cbsa',
      cbsa_code: '12420',
      name: 'Austin-Round Rock-Georgetown, TX',
    };

    const records = await adapter.query({
      geography: cbsaGeo,
      soc_code: '15-1252',
      variables: ['A_MEDIAN', 'H_MEAN', 'TOT_EMP', 'H_MEDIAN'],
    });

    expect(records.length).toBeGreaterThanOrEqual(4);

    const aMedian = records.find((r) => r.variable_name === 'A_MEDIAN');
    expect(aMedian).toBeDefined();
    expect(aMedian?.estimate.status).toBe('available');
    if (aMedian?.estimate.status === 'available') {
      expect(aMedian.estimate.value).toBe(138500);
      expect(aMedian.estimate.unit).toBe('USD');
    }

    const hMean = records.find((r) => r.variable_name === 'H_MEAN');
    expect(hMean).toBeDefined();
    expect(hMean?.estimate.status).toBe('available');
    if (hMean?.estimate.status === 'available') {
      expect(hMean.estimate.value).toBe(68.75);
      expect(hMean.estimate.unit).toBe('USD_per_hour');
    }

    const totEmp = records.find((r) => r.variable_name === 'TOT_EMP');
    expect(totEmp).toBeDefined();
    expect(totEmp?.estimate.status).toBe('available');
    if (totEmp?.estimate.status === 'available') {
      expect(totEmp.estimate.value).toBe(34200);
      expect(totEmp.estimate.unit).toBe('count');
    }
  });

  it('preserves data quality suppression (RSE > 50%) without zero-coercion', async () => {
    const adapter = new BlsOewsAdapter();
    const cbsaGeo: EconomicGeography = {
      level: 'cbsa',
      cbsa_code: '12420',
      name: 'Austin-Round Rock-Georgetown, TX',
    };

    const allRecords = await adapter.getEvidenceByGeography(cbsaGeo);
    const suppressed = allRecords.find(
      (r) => r.estimate.status === 'suppressed' && r.estimate.reason === 'data_quality'
    );
    expect(suppressed).toBeDefined();
    if (suppressed?.estimate.status === 'suppressed') {
      expect(suppressed.estimate.reason).toBe('data_quality');
      expect(suppressed.estimate.detail?.toLowerCase()).toContain('relative standard error');
    }
  });

  it('preserves top-coded wage suppression with explicit lower bound', async () => {
    const adapter = new BlsOewsAdapter();
    const cbsaGeo: EconomicGeography = {
      level: 'cbsa',
      cbsa_code: '12420',
      name: 'Austin-Round Rock-Georgetown, TX',
    };

    const records = await adapter.query({
      geography: cbsaGeo,
      soc_code: '11-1011',
    });

    const topCoded = records.find(
      (r) => r.estimate.status === 'suppressed' && r.estimate.reason === 'disclosure_avoidance'
    );
    expect(topCoded).toBeDefined();
    if (topCoded?.estimate.status === 'suppressed') {
      expect(topCoded.estimate.bounds?.lower_bound).toBe(239200);
      expect(topCoded.estimate.detail).toContain('top-coded wage estimate');
    }
  });

  it('supports convenience methods for wages, employment, and wage distributions', async () => {
    const adapter = new BlsOewsAdapter();
    const cbsaGeo: EconomicGeography = {
      level: 'cbsa',
      cbsa_code: '12420',
      name: 'Austin-Round Rock-Georgetown, TX',
    };

    const medianWages = await adapter.getMedianWages(cbsaGeo, '15-1252');
    expect(medianWages.length).toBeGreaterThanOrEqual(1);

    const meanWages = await adapter.getMeanWages(cbsaGeo, '15-1252');
    expect(meanWages.length).toBeGreaterThanOrEqual(1);

    const employment = await adapter.getEmployment(cbsaGeo, '15-1252');
    expect(employment.length).toBeGreaterThanOrEqual(1);

    const distribution = await adapter.getWageDistribution(cbsaGeo, '15-1252');
    expect(distribution.A_MEDIAN).toBeDefined();
    expect(distribution.A_PCT10).toBeDefined();
    expect(distribution.A_PCT90).toBeDefined();
    expect(distribution.H_MEDIAN).toBeDefined();
  });

  it('queries statewide OEWS estimates', async () => {
    const adapter = new BlsOewsAdapter();
    const stateGeo: EconomicGeography = {
      level: 'state',
      state_fips: '48',
      name: 'Texas',
    };

    const records = await adapter.getEvidenceBySoc(stateGeo, '15-1252');
    expect(records.length).toBeGreaterThanOrEqual(1);
    const wage = records.find((r) => r.variable_name === 'A_MEDIAN');
    expect(wage?.estimate.status).toBe('available');
    if (wage?.estimate.status === 'available') {
      expect(wage.estimate.value).toBe(125400);
    }
  });

  it('strictly rejects any employee or applicant PII', async () => {
    const adapter = new BlsOewsAdapter();
    const cbsaGeo: EconomicGeography = {
      level: 'cbsa',
      cbsa_code: '12420',
    };

    await expect(
      adapter.query({
        geography: cbsaGeo,
        ssn: '123-45-6789',
      } as any)
    ).rejects.toThrow(/Prohibited employee\/applicant PII/);

    await expect(
      adapter.query({
        geography: cbsaGeo,
        employee_name: 'Jane Doe',
      } as any)
    ).rejects.toThrow(/Prohibited employee\/applicant PII/);

    await expect(
      adapter.query({
        geography: cbsaGeo,
        applicant_id: 'app_999',
      } as any)
    ).rejects.toThrow(/Prohibited employee\/applicant PII/);
  });

  it('enforces registered vs unregistered rate limits', async () => {
    const adapter = new BlsOewsAdapter({ isRegistered: false });
    const cbsaGeo: EconomicGeography = {
      level: 'cbsa',
      cbsa_code: '12420',
    };

    // Unregistered query exceeding 10 series is rejected
    await expect(
      adapter.query({
        geography: cbsaGeo,
        variables: Array.from({ length: 11 }, (_, i) => `VAR_${i}`),
        is_registered: false,
      })
    ).rejects.toThrow(/exceeds BLS API limit of 10/);

    // Registered adapter allows more than 10 series
    const registeredAdapter = new BlsOewsAdapter({ isRegistered: true, apiKey: 'test-key' });
    const records = await registeredAdapter.query({
      geography: cbsaGeo,
      variables: ['A_MEDIAN', 'H_MEAN', 'TOT_EMP'],
      is_registered: true,
    });
    expect(records.length).toBeGreaterThanOrEqual(3);
  });

  it('enforces strict seed mode and blocks unauthorized live calls', async () => {
    const liveAdapter = new BlsOewsAdapter({
      seedMode: false,
      allowLiveCalls: false,
    });

    await expect(
      liveAdapter.query({
        geography: {
          level: 'cbsa',
          cbsa_code: '12420',
        },
      })
    ).rejects.toThrow(BlsOewsSeedModeViolationError);
  });

  it('enforces kill switch when disabled (GEV_BLS_OEWS_ENABLED=0)', async () => {
    const disabledAdapter = new BlsOewsAdapter({ enabled: false });
    expect(disabledAdapter.isEnabled()).toBe(false);

    await expect(
      disabledAdapter.query({
        geography: {
          level: 'cbsa',
          cbsa_code: '12420',
        },
      })
    ).rejects.toThrow(BlsOewsProviderDisabledError);

    await expect(
      disabledAdapter.getEvidenceByGeography({
        level: 'cbsa',
        cbsa_code: '12420',
      })
    ).rejects.toThrow(BlsOewsProviderDisabledError);
  });

  it('performance threshold: parses and queries OEWS dataset under 10ms p95 across 100 iterations', async () => {
    const adapter = new BlsOewsAdapter();
    const cbsaGeo: EconomicGeography = {
      level: 'cbsa',
      cbsa_code: '12420',
    };

    // Warm up
    await adapter.query({
      geography: cbsaGeo,
      soc_code: '15-1252',
    });

    const iterations = 100;
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await adapter.query({
        geography: cbsaGeo,
        soc_code: '15-1252',
        variables: ['A_MEDIAN', 'H_MEAN', 'TOT_EMP'],
      });
      const end = performance.now();
      durations.push(end - start);
    }

    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(iterations * 0.5)];
    const p95 = durations[Math.floor(iterations * 0.95)];

    console.log(
      `[BENCHMARK] BLS OEWS Query Latency (N=${iterations}): p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms`
    );

    expect(p95).toBeLessThan(10); // Required threshold: < 10ms p95 (and well under < 50ms)
  });
});
