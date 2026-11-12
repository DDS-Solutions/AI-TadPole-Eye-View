import { EPA_AQS_DATA_CLASSIFICATION, EPA_AQS_HISTORICAL_DISCLAIMER } from '@gev/contracts';
import { MockAgent, PinnedFetchSecurityError } from '@gev/security';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EpaAqsAdapter,
  EpaAqsAirNowScopeError,
  EpaAqsCredentialsMissingError,
  EpaAqsDisabledError,
  EpaAqsSeedModeViolationError,
} from '../src/epaAqs.js';

describe('EPA AQS Provider Adapter (PLAN.md §10 Task 11.3 & ADR 0064)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEV_EPA_AQS_ENABLED;
    delete process.env.GEV_SEED_MODE;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('respects GEV_EPA_AQS_ENABLED=0 and GEV_SEED_MODE=1 environment flags', async () => {
    process.env.GEV_EPA_AQS_ENABLED = '0';
    const disabledByEnv = new EpaAqsAdapter();
    expect(disabledByEnv.isEnabled()).toBe(false);
    await expect(
      disabledByEnv.querySummaries({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      })
    ).rejects.toThrow(EpaAqsDisabledError);

    delete process.env.GEV_EPA_AQS_ENABLED;
    process.env.GEV_SEED_MODE = '1';
    const seedByEnv = new EpaAqsAdapter({ allowLiveCalls: true });
    expect(seedByEnv.isSeedMode()).toBe(true);
    const res = await seedByEnv.querySummaries({
      geography: { level: 'county', county_fips: '48453', state_fips: '48' },
    });
    expect(res.provenance.mode).toBe('seed');
  });

  it('loads and validates deterministic synthetic seed fixture', () => {
    const adapter = new EpaAqsAdapter();
    expect(adapter.isEnabled()).toBe(true);
    expect(adapter.isSeedMode()).toBe(true);
    expect(adapter.getHistoricalDisclaimer()).toBe(EPA_AQS_HISTORICAL_DISCLAIMER);

    const fixture = adapter.loadFixture();
    expect(fixture.fixture_id).toBe('epa-aqs-synthetic-v1');
    expect(fixture.data_classification).toBe(EPA_AQS_DATA_CLASSIFICATION);
    expect(fixture.is_real_time).toBe(false);
    expect(fixture.sites.length).toBeGreaterThanOrEqual(5);
    expect(fixture.summaries.length).toBeGreaterThanOrEqual(10);
  });

  it('queries historical monitoring summaries by county and preserves unmonitored pollutants as unavailable', async () => {
    const adapter = new EpaAqsAdapter();
    const result = await adapter.querySummaries({
      geography: {
        level: 'county',
        county_fips: '48453',
        state_fips: '48',
        name: 'Travis County, TX',
      },
    });

    expect(result.data_classification).toBe('historical_regulatory_monitoring');
    expect(result.is_real_time).toBe(false);
    expect(result.advisory_disclaimer).toBe(EPA_AQS_HISTORICAL_DISCLAIMER);
    expect(result.provenance.mode).toBe('seed');
    expect(result.provenance.fixture_id).toBe('epa-aqs-synthetic-v1');
    expect(result.sites).toHaveLength(1);
    expect(result.sites[0]?.site_id).toBe('48-453-0014');

    // Travis County site monitors O3, PM2.5, NO2; does NOT monitor PM10, CO, SO2
    const o3Cov = result.pollutant_coverage.find((c) => c.pollutant_symbol === 'O3');
    const coCov = result.pollutant_coverage.find((c) => c.pollutant_symbol === 'CO');
    const so2Cov = result.pollutant_coverage.find((c) => c.pollutant_symbol === 'SO2');

    expect(o3Cov?.is_monitored).toBe(true);
    expect(o3Cov?.latest_arithmetic_mean.status).toBe('available');

    expect(coCov?.is_monitored).toBe(false);
    expect(coCov?.latest_arithmetic_mean.status).toBe('unavailable');
    expect(so2Cov?.is_monitored).toBe(false);
    expect(so2Cov?.latest_arithmetic_mean.status).toBe('unavailable');

    const coUnmonitoredRecord = result.summaries.find((s) => s.pollutant_symbol === 'CO');
    expect(coUnmonitoredRecord?.is_monitored).toBe(false);
    expect(coUnmonitoredRecord?.arithmetic_mean.status).toBe('unavailable');
  });

  it('preserves valid 0.0 monitored reading while keeping zero-observation outages unavailable', async () => {
    const adapter = new EpaAqsAdapter();

    // Phoenix CO Q2 has valid 0.0 ppm reading with observation_count = 2100
    const phoenix = await adapter.querySummaries({
      geography: { level: 'county', county_fips: '04013', state_fips: '04' },
      pollutants: ['CO', 'SO2'],
      summary_period: 'quarterly',
      year: 2024,
      quarter: 2,
    });

    const coRec = phoenix.summaries.find((s) => s.pollutant_symbol === 'CO');
    expect(coRec?.is_monitored).toBe(true);
    expect(coRec?.arithmetic_mean.status).toBe('available');
    if (coRec?.arithmetic_mean.status === 'available') {
      expect(coRec.arithmetic_mean.value).toBe(0);
    }

    const so2Rec = phoenix.summaries.find((s) => s.pollutant_symbol === 'SO2');
    expect(so2Rec?.is_monitored).toBe(false);
    expect(so2Rec?.arithmetic_mean.status).toBe('unavailable');

    // Los Angeles SO2 Q2 has observation_count = 0 (outage) -> unavailable
    const laOutage = await adapter.querySummaries({
      geography: { level: 'county', county_fips: '06037', state_fips: '06' },
      pollutants: ['SO2'],
      summary_period: 'quarterly',
      year: 2024,
      quarter: 2,
    });
    expect(laOutage.summaries[0]?.observation_count).toBe(0);
    expect(laOutage.summaries[0]?.arithmetic_mean.status).toBe('unavailable');
  });

  it('supports point, bounding_box, cbsa, and state geography queries', async () => {
    const adapter = new EpaAqsAdapter();

    const byPoint = await adapter.querySummaries({
      geography: { level: 'point', latitude: 34.06, longitude: -118.23 },
      radius_km: 25,
    });
    expect(byPoint.sites.some((s) => s.site_id === '06-037-1103')).toBe(true);

    const byCbsa = await adapter.querySummaries({
      geography: { level: 'cbsa', cbsa_code: '16980' },
    });
    expect(byCbsa.sites.some((s) => s.site_id === '17-031-0076')).toBe(true);

    const byState = await adapter.querySummaries({
      geography: { level: 'state', state_fips: '08' },
    });
    expect(byState.sites.some((s) => s.site_id === '08-031-0002')).toBe(true);
  });

  it('enforces GEV_EPA_AQS_ENABLED kill switch failing closed', async () => {
    const disabled = new EpaAqsAdapter({ enabled: false });
    await expect(
      disabled.querySummaries({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      })
    ).rejects.toThrow(EpaAqsDisabledError);
    await expect(disabled.getSites()).rejects.toThrow(EpaAqsDisabledError);
  });

  it('prohibits AirNow real-time AQI endpoints in constructor', () => {
    expect(
      () =>
        new EpaAqsAdapter({
          endpointUrl: 'https://www.airnowapi.org/aq/observation/zipCode/current/',
        })
    ).toThrow(EpaAqsAirNowScopeError);
  });

  it('rejects live API requests without explicit authorization or credentials', async () => {
    const unauthLive = new EpaAqsAdapter({
      seedMode: false,
      allowLiveCalls: false,
    });
    await expect(
      unauthLive.querySummaries({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      })
    ).rejects.toThrow(EpaAqsSeedModeViolationError);

    const missingCreds = new EpaAqsAdapter({
      seedMode: false,
      allowLiveCalls: true,
      email: '',
      apiKey: '',
    });
    await expect(
      missingCreds.querySummaries({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      })
    ).rejects.toThrow(EpaAqsCredentialsMissingError);
  });

  it('executes live API requests with pinnedFetch and MockAgent when explicitly authorized', async () => {
    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    const client = mockAgent.get('https://aqs.epa.gov');
    client
      .intercept({
        path: (p: string) => p.startsWith('/data/api/annualData/byCounty'),
        method: 'GET',
      })
      .reply(200, {
        Header: [{ status: 'Success', rows: 1 }],
        Data: [
          {
            state_code: '48',
            county_code: '453',
            site_number: '0014',
            parameter_code: '44201',
            year: 2024,
            units_of_measure: 'ppm',
            sample_duration: '8-HR RUN AVG BEGIN HOUR',
            metric_used: 'Daily Max of 8-hour running average',
            arithmetic_mean: 0.045,
            first_max_value: 0.071,
            second_max_value: 0.068,
            ninety_eighth_percentile: 0.063,
            observation_count: 350,
            observation_percent: 95.9,
            completeness_indicator: 'Y',
            events_included: 'No Events',
            county_name: 'Travis',
          },
        ],
      });

    const liveAdapter = new EpaAqsAdapter({
      seedMode: false,
      allowLiveCalls: true,
      email: 'operator@example.com',
      apiKey: 'test-aqs-key',
      pinnedFetchOptions: {
        dispatcher: mockAgent,
        customResolver: {
          resolve4: async () => ['134.67.99.25'],
          resolve6: async () => [],
        },
      },
    });

    const result = await liveAdapter.querySummaries({
      geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      pollutants: ['O3', 'SO2'],
      summary_period: 'annual',
      year: 2024,
    });

    expect(result.provenance.mode).toBe('live');
    expect(result.is_real_time).toBe(false);
    expect(result.data_classification).toBe('historical_regulatory_monitoring');
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]?.arithmetic_mean.status).toBe('available');

    // SO2 was not returned by EPA AQS -> coverage must be unmonitored/unavailable, not 0.0
    const so2Cov = result.pollutant_coverage.find((c) => c.pollutant_symbol === 'SO2');
    expect(so2Cov?.is_monitored).toBe(false);
    expect(so2Cov?.latest_arithmetic_mean.status).toBe('unavailable');
  });

  it('rejects live calls to non-allowlisted hosts via SSRF guard and redacts credentials on error', async () => {
    const evilAdapter = new EpaAqsAdapter({
      seedMode: false,
      allowLiveCalls: true,
      endpointUrl: 'https://evil.internal.example.com/data/api',
      email: 'secret-user@example.com',
      apiKey: 'super-secret-key',
      pinnedFetchOptions: {
        customResolver: {
          resolve4: async () => ['192.168.1.10'],
          resolve6: async () => [],
        },
      },
    });

    let caughtError: unknown;
    try {
      await evilAdapter.querySummaries({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(PinnedFetchSecurityError);
    const msg = caughtError instanceof Error ? caughtError.message : String(caughtError);
    expect(msg).not.toContain('super-secret-key');
    expect(msg).not.toContain('secret-user@example.com');
  });

  it('proves p95 query latency is strictly < 25ms in seed mode (PLAN.md §10 Task 11.3)', async () => {
    const adapter = new EpaAqsAdapter();

    // Warm-up V8 JIT across 10 iterations before timing
    for (let w = 0; w < 10; w++) {
      await adapter.querySummaries({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      });
    }

    const iterations = 100;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await adapter.querySummaries({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      });
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(iterations * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(iterations * 0.95)] ?? 0;
    console.log(
      `[BENCHMARK] EPA AQS Query Latency (N=${iterations}): p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms`
    );
    expect(p95).toBeLessThan(25);
  });
});
