import { DOT_BTS_DATA_HORIZON, DOT_BTS_SCREENING_DISCLAIMER } from '@gev/contracts';
import { MockAgent, PinnedFetchSecurityError } from '@gev/security';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DotBtsAdapter, DotBtsDisabledError, DotBtsSeedModeViolationError } from '../src/dotBts.js';

describe('DOT/BTS Accessibility Provider Adapter (PLAN.md §10 Task 11.4 & ADR 0065)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEV_DOT_BTS_ENABLED;
    delete process.env.GEV_SEED_MODE;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('loads synthetic seed fixture and respects GEV_DOT_BTS_ENABLED=0 and GEV_SEED_MODE=1', async () => {
    const adapter = new DotBtsAdapter();
    expect(adapter.isEnabled()).toBe(true);
    expect(adapter.isSeedMode()).toBe(true);
    expect(adapter.getScreeningDisclaimer()).toBe(DOT_BTS_SCREENING_DISCLAIMER);

    const fixture = adapter.loadFixture();
    expect(fixture.fixture_id).toBe('dot-bts-synthetic-v1');
    expect(fixture.data_horizon).toBe(DOT_BTS_DATA_HORIZON);
    expect(fixture.records.length).toBeGreaterThanOrEqual(5);

    process.env.GEV_DOT_BTS_ENABLED = '0';
    const disabled = new DotBtsAdapter();
    await expect(
      disabled.queryAccessibility({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      })
    ).rejects.toThrow(DotBtsDisabledError);
  });

  it('queries accessibility metrics by county and point while preserving uncovered geographies as unavailable', async () => {
    const adapter = new DotBtsAdapter();

    const travis = await adapter.queryAccessibility({
      geography: { level: 'county', county_fips: '48453', state_fips: '48' },
    });
    expect(travis.records).toHaveLength(1);
    expect(travis.records[0]?.is_covered).toBe(true);
    expect(travis.records[0]?.accessibility_tier).toBe('high_access');
    expect(travis.records[0]?.provenance.mode).toBe('seed');

    const byPoint = await adapter.queryAccessibility({
      geography: { level: 'point', latitude: 34.06, longitude: -118.23 },
      radius_km: 25,
    });
    expect(byPoint.records).toHaveLength(1);
    expect(byPoint.records[0]?.freight_exposure).toBe('primary_freight_corridor');

    const uncovered = await adapter.queryAccessibility({
      geography: { level: 'county', county_fips: '02185', state_fips: '02' },
    });
    expect(uncovered.records).toHaveLength(1);
    expect(uncovered.records[0]?.is_covered).toBe(false);
    expect(uncovered.records[0]?.accessibility_tier).toBe('unavailable');
    expect(uncovered.records[0]?.nearest_transit_stop_km.status).toBe('unavailable');
  });

  it('enforces seed mode guard and executes live pinnedFetch with MockAgent when authorized', async () => {
    const unauth = new DotBtsAdapter({ seedMode: false, allowLiveCalls: false });
    await expect(
      unauth.queryAccessibility({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      })
    ).rejects.toThrow(DotBtsSeedModeViolationError);

    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    const client = mockAgent.get('https://data.bts.gov');
    client
      .intercept({
        path: (p: string) => p.startsWith('/resource/ye4a-f2v9.json'),
        method: 'GET',
      })
      .reply(200, [
        {
          county_fips: '48453',
          nearest_interstate_km: 1.2,
          nearest_transit_stop_km: 0.4,
          transit_stops_within_1km: 7,
          freight_corridor_distance_km: 1.5,
          walkable_road_density_km_per_sqkm: 10.8,
          commute_mean_minutes: 25.0,
        },
      ]);

    const live = new DotBtsAdapter({
      seedMode: false,
      allowLiveCalls: true,
      pinnedFetchOptions: {
        dispatcher: mockAgent,
        customResolver: {
          resolve4: async () => ['52.206.100.10'],
          resolve6: async () => [],
        },
      },
    });

    const result = await live.queryAccessibility({
      geography: { level: 'county', county_fips: '48453', state_fips: '48' },
    });
    expect(result.provenance.mode).toBe('live');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.accessibility_tier).toBe('high_access');

    const ssrfEvil = new DotBtsAdapter({
      seedMode: false,
      allowLiveCalls: true,
      endpointUrl: 'https://evil.internal.example.com/resource',
      pinnedFetchOptions: {
        customResolver: {
          resolve4: async () => ['192.168.1.5'],
          resolve6: async () => [],
        },
      },
    });
    await expect(
      ssrfEvil.queryAccessibility({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      })
    ).rejects.toThrow(PinnedFetchSecurityError);
  });

  it('proves p95 query latency is strictly < 25ms in seed mode (PLAN.md §10 Task 11.4)', async () => {
    const adapter = new DotBtsAdapter();
    await adapter.queryAccessibility({
      geography: { level: 'county', county_fips: '48453', state_fips: '48' },
    });

    const iterations = 100;
    const latencies: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await adapter.queryAccessibility({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      });
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(iterations * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(iterations * 0.95)] ?? 0;
    console.log(
      `[BENCHMARK] DOT/BTS Query Latency (N=${iterations}): p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms`
    );
    expect(p95).toBeLessThan(25);
  });
});
