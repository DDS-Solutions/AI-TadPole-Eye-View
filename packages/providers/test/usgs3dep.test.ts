import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USGS_3DEP_ADVISORY_DISCLAIMER, USGS_3DEP_MODERN_EPQS_URL } from '@gev/contracts';
import { MockAgent, PinnedFetchSecurityError } from '@gev/security';
import {
  USGS_3DEP_FEED_ID,
  USGS_3DEP_PROVIDER_ID,
  Usgs3DepAdapter,
  Usgs3DepDisabledError,
  Usgs3DepRetiredEndpointError,
  Usgs3DepSeedModeViolationError,
} from '../src/index.js';

describe('USGS 3DEP Provider Adapter (PLAN.md §10 Task 11.2 & ADR 0063)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEV_USGS_3DEP_ENABLED;
    delete process.env.GEV_SEED_MODE;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('initializes in seed mode by default with modern EPQS URL and disclaimer', () => {
    const adapter = new Usgs3DepAdapter();
    expect(adapter.isEnabled()).toBe(true);
    expect(adapter.isSeedMode()).toBe(true);
    expect(adapter.getEndpointUrl()).toBe(USGS_3DEP_MODERN_EPQS_URL);
    expect(adapter.getAdvisoryDisclaimer()).toBe(USGS_3DEP_ADVISORY_DISCLAIMER);
  });

  it('strictly rejects initialization with the retired legacy pqs.php endpoint', () => {
    expect(
      () =>
        new Usgs3DepAdapter({
          endpointUrl: 'https://nationalmap.gov/epqs/pqs.php',
        })
    ).toThrow(Usgs3DepRetiredEndpointError);
  });

  it('queries mountain and coastal elevation points deterministically in seed mode', async () => {
    const adapter = new Usgs3DepAdapter();

    // Boulder, CO (Mountain foothills)
    const boulder = await adapter.getElevation({ x: -105.2705, y: 40.015, units: 'Meters' });
    expect(boulder.is_off_coverage).toBe(false);
    expect(boulder.elevation.status).toBe('available');
    if (boulder.elevation.status === 'available') {
      expect(boulder.elevation.value).toBe(1630.5);
      expect(boulder.elevation.unit).toBe('Meters');
    }
    expect(boulder.data_source).toContain('3DEP');
    expect(boulder.vertical_datum).toBe('NAVD88');
    expect(boulder.horizontal_datum).toBe('NAD83');
    expect(boulder.provenance.source.provider_id).toBe(USGS_3DEP_PROVIDER_ID);
    expect(boulder.provenance.source.feed_id).toBe(USGS_3DEP_FEED_ID);

    // Miami, FL (Low-lying coast)
    const miami = await adapter.getElevation({ x: -80.1918, y: 25.7617, units: 'Meters' });
    expect(miami.is_off_coverage).toBe(false);
    expect(miami.elevation.status).toBe('available');
    if (miami.elevation.status === 'available') {
      expect(miami.elevation.value).toBe(2.1);
    }
  });

  it('preserves valid negative elevations on land as available without zero-coercion', async () => {
    const adapter = new Usgs3DepAdapter();

    // Badwater Basin, Death Valley, CA (-86m NAVD88)
    const deathValley = await adapter.getElevation({
      x: -116.8258,
      y: 36.2503,
      units: 'Meters',
    });
    expect(deathValley.is_off_coverage).toBe(false);
    expect(deathValley.elevation.status).toBe('available');
    if (deathValley.elevation.status === 'available') {
      expect(deathValley.elevation.value).toBe(-86.0);
    }
  });

  it('evaluates legitimate shoreline sea-level points as 0.0 available', async () => {
    const adapter = new Usgs3DepAdapter();

    // Monterey Bay shoreline benchmark
    const shoreline = await adapter.getElevation({
      x: -122.0308,
      y: 36.9741,
      units: 'Meters',
    });
    expect(shoreline.is_off_coverage).toBe(false);
    expect(shoreline.elevation.status).toBe('available');
    if (shoreline.elevation.status === 'available') {
      expect(shoreline.elevation.value).toBe(0.0);
    }
  });

  it('enforces non-coercion: off-coverage ocean points evaluate to unavailable, NEVER 0.0 sea level', async () => {
    const adapter = new Usgs3DepAdapter();

    // Atlantic Ocean offshore
    const atlantic = await adapter.getElevation({ x: -70.0, y: 25.0, units: 'Meters' });
    expect(atlantic.is_off_coverage).toBe(true);
    expect(atlantic.elevation.status).toBe('unavailable');
    expect(atlantic.elevation_meters.status).toBe('unavailable');
    expect(atlantic.elevation_feet.status).toBe('unavailable');
    if (atlantic.elevation.status === 'unavailable') {
      expect(atlantic.elevation.reason).toContain('-1000000 off-coverage');
    }

    // Pacific Ocean offshore
    const pacific = await adapter.getElevation({ x: -125.0, y: 32.0, units: 'Meters' });
    expect(pacific.is_off_coverage).toBe(true);
    expect(pacific.elevation.status).toBe('unavailable');

    // Unmapped arbitrary coordinate outside seed fixture
    const unmapped = await adapter.getElevation({ x: 10.0, y: 50.0, units: 'Meters' });
    expect(unmapped.is_off_coverage).toBe(true);
    expect(unmapped.elevation.status).toBe('unavailable');
  });

  it('supports elevation queries in Feet with accurate conversion', async () => {
    const adapter = new Usgs3DepAdapter();

    const boulderFeet = await adapter.getElevation({
      x: -105.2705,
      y: 40.015,
      units: 'Feet',
    });
    expect(boulderFeet.elevation.status).toBe('available');
    if (boulderFeet.elevation.status === 'available') {
      expect(boulderFeet.elevation.unit).toBe('Feet');
      expect(boulderFeet.elevation.value).toBeCloseTo(5349.4, 1);
    }
    expect(boulderFeet.elevation_meters.status).toBe('available');
    if (boulderFeet.elevation_meters.status === 'available') {
      expect(boulderFeet.elevation_meters.value).toBe(1630.5);
    }
  });

  it('queries batch coordinate points concurrently via getElevations', async () => {
    const adapter = new Usgs3DepAdapter();

    const results = await adapter.getElevations([
      { x: -105.2705, y: 40.015, units: 'Meters' },
      { x: -80.1918, y: 25.7617, units: 'Meters' },
      { x: -70.0, y: 25.0, units: 'Meters' },
    ]);

    expect(results).toHaveLength(3);
    expect(results[0]?.elevation.status).toBe('available');
    expect(results[1]?.elevation.status).toBe('available');
    expect(results[2]?.elevation.status).toBe('unavailable');

    // Batch query limit of 100 enforced by Usgs3DepBatchQuerySchema
    const excessiveQueries = Array.from({ length: 101 }, () => ({
      x: -105.2705,
      y: 40.015,
      units: 'Meters' as const,
    }));
    await expect(adapter.getElevations(excessiveQueries)).rejects.toThrow();
  });

  it('calculates terrain slope between two points and attaches disclaimer and provenance', async () => {
    const adapter = new Usgs3DepAdapter();

    const slope = await adapter.getSlope(
      { x: -105.2705, y: 40.015, units: 'Meters' }, // Boulder 1630.5m
      { x: -106.4454, y: 39.1178, units: 'Meters' } // Mount Elbert 4401.2m
    );

    expect(slope.horizontal_distance_meters).toBeGreaterThan(100000);
    expect(slope.elevation_change_meters.status).toBe('available');
    if (slope.elevation_change_meters.status === 'available') {
      expect(slope.elevation_change_meters.value).toBeCloseTo(2770.7, 1);
    }
    expect(slope.slope_percent.status).toBe('available');
    expect(slope.provenance_start).toBeDefined();
    expect(slope.provenance_end).toBeDefined();
    expect(slope.advisory_disclaimer).toBe(USGS_3DEP_ADVISORY_DISCLAIMER);
  });

  it('enforces kill switch GEV_USGS_3DEP_ENABLED=0 failing closed', async () => {
    const disabledAdapter = new Usgs3DepAdapter({ enabled: false });
    await expect(
      disabledAdapter.getElevation({ x: -105.2705, y: 40.015, units: 'Meters' })
    ).rejects.toThrow(Usgs3DepDisabledError);
  });

  it('rejects live API requests in seed mode without explicit authorization', async () => {
    const liveAttemptAdapter = new Usgs3DepAdapter({
      seedMode: false,
      allowLiveCalls: false,
    });

    await expect(
      liveAttemptAdapter.getElevation({ x: -105.2705, y: 40.015, units: 'Meters' })
    ).rejects.toThrow(Usgs3DepSeedModeViolationError);
  });

  it('executes live API requests with pinnedFetch and MockAgent when explicitly authorized', async () => {
    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    const client = mockAgent.get('https://epqs.nationalmap.gov');
    client
      .intercept({
        path: (path: string) => path.startsWith('/v1/json'),
        method: 'GET',
      })
      .reply(200, {
        USGS_Elevation_Point_Query_Service: {
          Elevation_Query: {
            x: -105.2705,
            y: 40.015,
            Data_Source: '3DEP 1/3 arc-second',
            Units: 'Meters',
            Elevation: 1630.5,
          },
        },
      });

    const mockResolver = {
      resolve4: async () => ['137.227.240.23'],
      resolve6: async () => [],
    };

    const liveAdapter = new Usgs3DepAdapter({
      seedMode: false,
      allowLiveCalls: true,
      pinnedFetchOptions: {
        dispatcher: mockAgent,
        customResolver: mockResolver,
      },
    });

    const result = await liveAdapter.getElevation({ x: -105.2705, y: 40.015, units: 'Meters' });

    expect(result.elevation.status).toBe('available');
    if (result.elevation.status === 'available') {
      expect(result.elevation.value).toBe(1630.5);
    }
    expect(result.horizontal_datum).toBe('NAD83');
    expect(result.vertical_datum).toBe('NAVD88');
    expect(result.provenance.source_mode).toBe('live');
  });

  it('handles live off-coverage sentinel response by evaluating to unavailable', async () => {
    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    const client = mockAgent.get('https://epqs.nationalmap.gov');
    client
      .intercept({
        path: (path: string) => path.startsWith('/v1/json'),
        method: 'GET',
      })
      .reply(200, {
        USGS_Elevation_Point_Query_Service: {
          Elevation_Query: {
            x: -70.0,
            y: 25.0,
            Data_Source: 'Unavailable',
            Units: 'Meters',
            Elevation: -1000000,
          },
        },
      });

    const liveAdapter = new Usgs3DepAdapter({
      seedMode: false,
      allowLiveCalls: true,
      pinnedFetchOptions: {
        dispatcher: mockAgent,
        customResolver: {
          resolve4: async () => ['137.227.240.23'],
          resolve6: async () => [],
        },
      },
    });

    const result = await liveAdapter.getElevation({ x: -70.0, y: 25.0, units: 'Meters' });
    expect(result.is_off_coverage).toBe(true);
    expect(result.elevation.status).toBe('unavailable');
  });

  it('rejects live calls to non-allowlisted endpoint hosts via SSRF guard', async () => {
    const disallowedAdapter = new Usgs3DepAdapter({
      seedMode: false,
      allowLiveCalls: true,
      endpointUrl: 'https://evil.internal.example.com/v1/json',
      pinnedFetchOptions: {
        customResolver: {
          resolve4: async () => ['192.168.1.1'],
          resolve6: async () => [],
        },
      },
    });

    await expect(
      disallowedAdapter.getElevation({ x: -105.2705, y: 40.015, units: 'Meters' })
    ).rejects.toThrow(PinnedFetchSecurityError);
  });

  it('handles live upstream 503 HTTP error by throwing descriptive error', async () => {
    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    const client = mockAgent.get('https://epqs.nationalmap.gov');
    client
      .intercept({
        path: (path: string) => path.startsWith('/v1/json'),
        method: 'GET',
      })
      .reply(503, 'Service Unavailable');

    const liveAdapter = new Usgs3DepAdapter({
      seedMode: false,
      allowLiveCalls: true,
      pinnedFetchOptions: {
        dispatcher: mockAgent,
        customResolver: {
          resolve4: async () => ['137.227.240.23'],
          resolve6: async () => [],
        },
      },
    });

    await expect(
      liveAdapter.getElevation({ x: -105.2705, y: 40.015, units: 'Meters' })
    ).rejects.toThrow(/HTTP 503/);
  });

  it('proves p95 query latency is strictly < 25ms in seed mode (PLAN.md §10 Task 11.2)', async () => {
    const adapter = new Usgs3DepAdapter();

    // Warm-up query
    await adapter.getElevation({ x: -105.2705, y: 40.015, units: 'Meters' });

    const iterations = 100;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await adapter.getElevation({ x: -105.2705, y: 40.015, units: 'Meters' });
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95 = latencies[p95Index] ?? 0;

    console.log(
      `[BENCHMARK] USGS 3DEP Query Latency (N=${iterations}): p50=${latencies[Math.floor(iterations * 0.5)]?.toFixed(3)}ms, p95=${p95.toFixed(3)}ms`
    );
    expect(p95).toBeLessThan(25);
  });
});
