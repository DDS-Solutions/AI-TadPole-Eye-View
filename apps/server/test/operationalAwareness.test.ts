import {
  AviationWeatherResponseSchema,
  NwsAlertCollectionSchema,
  SolarContextResponseSchema,
} from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { createProviderRegistry } from '@gev/providers';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index.js';

const clockMs = Date.parse('2024-08-25T10:00:00.000Z');
const authorization = { Authorization: 'Bearer operational-test-token' };

function authenticatedRuntime() {
  const clock = new FrozenClock(clockMs);
  const governanceContext = createGovernanceRuntimeContext({ clock, dbPath: ':memory:' });
  return {
    clock,
    governanceContext,
    composition: createApp({
      clock,
      governanceContext,
      opsAuth: { requireAuth: true, opsToken: 'operational-test-token' },
      resolveClientId: () => 'operational-test-client',
    }),
  };
}

describe('operational-awareness server composition', () => {
  it('protects every route and serves deterministic schema-valid seed responses', async () => {
    const runtime = authenticatedRuntime();
    try {
      expect((await runtime.composition.app.request('/api/operational/solar')).status).toBe(401);
      expect((await runtime.composition.app.request('/api/operational/alerts')).status).toBe(401);
      expect((await runtime.composition.app.request('/api/operational/aviation')).status).toBe(401);

      const solarResponse = await runtime.composition.app.request('/api/operational/solar', {
        headers: authorization,
      });
      const alertsResponse = await runtime.composition.app.request('/api/operational/alerts', {
        headers: authorization,
      });
      const aviationResponse = await runtime.composition.app.request('/api/operational/aviation', {
        headers: authorization,
      });
      const solar = SolarContextResponseSchema.parse(await solarResponse.json());
      const alerts = NwsAlertCollectionSchema.parse(await alertsResponse.json());
      const aviation = AviationWeatherResponseSchema.parse(await aviationResponse.json());

      expect(solarResponse.status).toBe(200);
      expect(alertsResponse.status).toBe(200);
      expect(aviationResponse.status).toBe(200);
      expect(solar.computed_at).toBe(runtime.clock.iso());
      expect(alerts).toMatchObject({ count: 2, provenance: { mode: 'seed' } });
      expect(aviation.metars.count + aviation.tafs.count + aviation.sigmets.count).toBe(5);
      expect(runtime.composition.budgetGovernor.state().spent_usd).toBe(0);
    } finally {
      runtime.governanceContext.close();
    }
  });

  it('validates AOI bounds before provider access and caches fixed requests at source cadence', async () => {
    const runtime = authenticatedRuntime();
    try {
      const invalid = await runtime.composition.app.request(
        '/api/operational/alerts?min_lat=0&max_lat=31&min_lon=0&max_lon=10',
        { headers: authorization }
      );
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toMatchObject({ code: 'INVALID_AOI' });

      const first = await runtime.composition.app.request('/api/operational/alerts', {
        headers: authorization,
      });
      const second = await runtime.composition.app.request('/api/operational/alerts', {
        headers: authorization,
      });
      expect(first.headers.get('X-GEV-Cache')).toBe('MISS');
      expect(first.headers.get('X-GEV-TTL-Sec')).toBe('30');
      expect(second.headers.get('X-GEV-Cache')).toBe('HIT');
      expect(NwsAlertCollectionSchema.parse(await second.json()).provenance.mode).toBe('cached');

      const firstAviation = await runtime.composition.app.request('/api/operational/aviation', {
        headers: authorization,
      });
      const secondAviation = await runtime.composition.app.request('/api/operational/aviation', {
        headers: authorization,
      });
      expect(firstAviation.headers.get('X-GEV-TTL-Sec')).toBe('60');
      expect(secondAviation.headers.get('X-GEV-Cache')).toBe('HIT');
    } finally {
      runtime.governanceContext.close();
    }
  });

  it('applies the per-source upstream request ceilings to distinct cache keys', async () => {
    const runtime = authenticatedRuntime();
    try {
      const aois = [
        '?min_lat=36&max_lat=42&min_lon=-109&max_lon=-102',
        '?min_lat=24&max_lat=31&min_lon=-87&max_lon=-80',
        '?min_lat=32&max_lat=38&min_lon=-101&max_lon=-94',
      ];
      expect(
        (
          await runtime.composition.app.request(`/api/operational/alerts${aois[0]}`, {
            headers: authorization,
          })
        ).status
      ).toBe(200);
      expect(
        (
          await runtime.composition.app.request(`/api/operational/alerts${aois[1]}`, {
            headers: authorization,
          })
        ).status
      ).toBe(200);
      const limited = await runtime.composition.app.request(`/api/operational/alerts${aois[2]}`, {
        headers: authorization,
      });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
      await expect(limited.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' });
    } finally {
      runtime.governanceContext.close();
    }
  });

  it('stops before cached data when shared governance enters STASIS', async () => {
    const runtime = authenticatedRuntime();
    try {
      expect(
        (
          await runtime.composition.app.request('/api/operational/solar', {
            headers: authorization,
          })
        ).status
      ).toBe(200);
      runtime.composition.budgetGovernor.trip('LOGIC_BLOCKER', 'Synthetic task 5.3.2 trip');
      const stopped = await runtime.composition.app.request('/api/operational/solar', {
        headers: authorization,
      });
      expect(stopped.status).toBe(423);
      await expect(stopped.json()).resolves.toMatchObject({ code: 'STASIS_ACTIVE' });
    } finally {
      runtime.governanceContext.close();
    }
  });

  it('fails closed in live mode while source approval records are absent', async () => {
    const runtime = authenticatedRuntime();
    vi.stubEnv('GEV_NWS_ALERTS_LIVE_ACCESS', '0');
    vi.stubEnv('GEV_NWS_ALERTS_TERMS_APPROVED', '0');
    vi.stubEnv('GEV_AWC_WEATHER_LIVE_ACCESS', '0');
    vi.stubEnv('GEV_AWC_TERMS_APPROVED', '0');
    try {
      const liveComposition = createApp({
        clock: runtime.clock,
        governanceContext: runtime.governanceContext,
        providerRegistry: createProviderRegistry({ requestedMode: 'live' }),
        opsAuth: { requireAuth: true, opsToken: 'operational-test-token' },
      });
      const alerts = await liveComposition.app.request('/api/operational/alerts', {
        headers: authorization,
      });
      const aviation = await liveComposition.app.request('/api/operational/aviation', {
        headers: authorization,
      });
      expect(alerts.status).toBe(423);
      expect(aviation.status).toBe(423);
      await expect(alerts.json()).resolves.toMatchObject({ code: 'TERMS_APPROVAL_REQUIRED' });
      await expect(aviation.json()).resolves.toMatchObject({ code: 'TERMS_APPROVAL_REQUIRED' });
    } finally {
      vi.unstubAllEnvs();
      runtime.governanceContext.close();
    }
  });
});
