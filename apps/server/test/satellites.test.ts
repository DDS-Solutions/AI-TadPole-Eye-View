import { ProviderFeedHealthResponseSchema, SatellitePropagationBatchSchema } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { createProviderRegistry } from '@gev/providers';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index.js';

const clock = new FrozenClock(Date.parse('2026-09-04T12:30:00.000Z'));

function liveOmm(id = 1) {
  return {
    OBJECT_NAME: `TEST OBJECT ${id}`,
    OBJECT_ID: `2026-00${id}A`,
    EPOCH: '2026-09-04T12:00:00.000Z',
    MEAN_MOTION: 15.25,
    ECCENTRICITY: 0.001,
    INCLINATION: 51.6,
    RA_OF_ASC_NODE: 20,
    ARG_OF_PERICENTER: 40,
    MEAN_ANOMALY: 10,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: id,
    ELEMENT_SET_NO: 1,
    REV_AT_EPOCH: 10,
    BSTAR: 0.00001,
    MEAN_MOTION_DOT: 0,
    MEAN_MOTION_DDOT: 0,
  };
}

describe('satellite server composition', () => {
  it('serves deterministic derived seed positions with provenance and zero network calls', async () => {
    const fetcher = vi.fn();
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:' });
    try {
      const { app } = createApp({ clock, governanceContext: runtime, satelliteFetcher: fetcher });
      const response = await app.request('/api/satellites');
      const batch = SatellitePropagationBatchSchema.parse(await response.json());

      expect(response.status).toBe(200);
      expect(fetcher).not.toHaveBeenCalled();
      expect(batch.states).toHaveLength(4);
      expect(batch.propagated_at).toBe(clock.iso());
      expect(batch.is_estimate).toBe(true);
      expect(batch.provenance).toMatchObject({
        source: { provider_id: 'celestrak' },
        mode: 'seed',
        fixture_id: 'satellites-synthetic-v1',
      });
    } finally {
      runtime.close();
    }
  });

  it('reports a disabled satellite feed before fixture or network access', async () => {
    const fetcher = vi.fn();
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:' });
    try {
      const { app } = createApp({
        clock,
        governanceContext: runtime,
        satellitesEnabled: false,
        satelliteFetcher: fetcher,
      });
      const response = await app.request('/api/satellites');
      const health = ProviderFeedHealthResponseSchema.parse(
        await (await app.request('/api/feeds/health')).json()
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ code: 'PROVIDER_DISABLED' });
      expect(fetcher).not.toHaveBeenCalled();
      expect(health.feeds.find((feed) => feed.id === 'satellites')).toMatchObject({
        status: 'degraded',
      });
    } finally {
      runtime.close();
    }
  });

  it('keeps live production access visibly unavailable until terms are recorded', async () => {
    const fetcher = vi.fn();
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:' });
    try {
      const { app } = createApp({
        clock,
        governanceContext: runtime,
        providerRegistry: createProviderRegistry({ requestedMode: 'live' }),
        satelliteLiveAccessEnabled: true,
        celestrakTermsApproved: false,
        satelliteFetcher: fetcher,
      });
      const response = await app.request('/api/satellites');
      const health = ProviderFeedHealthResponseSchema.parse(
        await (await app.request('/api/feeds/health')).json()
      );
      expect(response.status).toBe(423);
      await expect(response.json()).resolves.toMatchObject({ code: 'TERMS_APPROVAL_REQUIRED' });
      expect(fetcher).not.toHaveBeenCalled();
      expect(health.feeds.find((feed) => feed.id === 'satellites')).toMatchObject({
        mode: 'unavailable',
        status: 'unavailable',
      });
    } finally {
      runtime.close();
    }
  });

  it('propagates validated live OMM only after both administrator gates are open', async () => {
    let id = 0;
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify([liveOmm(++id)]),
    }));
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:' });
    try {
      const { app } = createApp({
        clock,
        governanceContext: runtime,
        providerRegistry: createProviderRegistry({ requestedMode: 'live' }),
        satelliteLiveAccessEnabled: true,
        celestrakTermsApproved: true,
        satelliteFetcher: fetcher,
      });
      const response = await app.request('/api/satellites');
      const batch = SatellitePropagationBatchSchema.parse(await response.json());
      expect(response.status).toBe(200);
      expect(batch.states).toHaveLength(4);
      expect(batch.provenance.source_mode).toBe('live');
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      runtime.close();
    }
  });
});
