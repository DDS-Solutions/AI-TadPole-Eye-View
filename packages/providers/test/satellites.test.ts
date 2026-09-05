import fs from 'node:fs';
import { SatelliteCatalogResponseSchema } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { describe, expect, it, vi } from 'vitest';
import {
  CELESTRAK_GP_HOST,
  CELESTRAK_GP_PATH,
  SATELLITE_CACHE_FRESH_SECONDS,
  SATELLITE_LIVE_GROUPS,
  SATELLITE_TRANSIENT_RETRY_SECONDS,
  SatelliteAdapter,
  SatelliteLiveAccessLockedError,
  SatelliteProviderDisabledError,
} from '../src/satellites.js';

const epoch = Date.parse('2026-09-04T12:00:00.000Z');

function rawOmm(id: number) {
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

function responseFor(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
  };
}

describe('satellite GP/OMM provider boundary', () => {
  it('uses only the synthetic fixture in seed mode and opens no socket', async () => {
    const fetcher = vi.fn();
    const catalog = SatelliteCatalogResponseSchema.parse(
      await new SatelliteAdapter({ clock: new FrozenClock(epoch), fetcher }).getCatalog()
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(catalog.elements).toHaveLength(4);
    expect(catalog.elements.every((element) => element.is_synthetic)).toBe(true);
    expect(catalog.elements.every((element) => element.catalog_id.startsWith('synthetic-'))).toBe(
      true
    );
    expect(catalog.provenance).toMatchObject({
      mode: 'seed',
      source_mode: 'seed',
      fixture_id: 'satellites-synthetic-v1',
      license: { id: 'gev-synthetic-fixture-mit' },
    });
  });

  it('applies kill and licensing locks before filesystem or network access', async () => {
    const readSpy = vi.spyOn(fs.promises, 'readFile');
    const fetcher = vi.fn();
    try {
      await expect(
        new SatelliteAdapter({ enabled: false, fetcher }).getCatalog()
      ).rejects.toBeInstanceOf(SatelliteProviderDisabledError);
      await expect(
        new SatelliteAdapter({
          seedMode: false,
          liveMode: true,
          liveAccessEnabled: true,
          termsApproved: false,
          fetcher,
        }).getCatalog()
      ).rejects.toBeInstanceOf(SatelliteLiveAccessLockedError);
      expect(readSpy).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
  });

  it('uses fixed allowlisted groups and one shared two-hour source cache', async () => {
    const clock = new FrozenClock(epoch);
    const fetcher = vi.fn(async (url: URL) => {
      const groupIndex = SATELLITE_LIVE_GROUPS.indexOf(
        url.searchParams.get('GROUP') as (typeof SATELLITE_LIVE_GROUPS)[number]
      );
      return responseFor([rawOmm(groupIndex + 1)]);
    });
    const adapter = new SatelliteAdapter({
      clock,
      seedMode: false,
      liveMode: true,
      liveAccessEnabled: true,
      termsApproved: true,
      fetcher,
    });

    const first = await adapter.getCatalog();
    clock.setTime(epoch + (SATELLITE_CACHE_FRESH_SECONDS - 1) * 1_000);
    const second = await adapter.getCatalog();

    expect(first.elements).toHaveLength(4);
    expect(second.provenance.mode).toBe('cached');
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url.hostname).toBe(CELESTRAK_GP_HOST);
      expect(url.pathname).toBe(CELESTRAK_GP_PATH);
      expect(SATELLITE_LIVE_GROUPS).toContain(url.searchParams.get('GROUP'));
      expect(url.searchParams.get('FORMAT')).toBe('JSON');
      expect(options).toMatchObject({
        allowedHosts: [CELESTRAK_GP_HOST],
        allowedPaths: [{ host: CELESTRAK_GP_HOST, pathPrefix: CELESTRAK_GP_PATH }],
        timeoutMs: 15_000,
        maxBytes: 4_000_000,
      });
    }
  });

  it('falls back only to a validated cache inside the 24-hour stale ceiling', async () => {
    const clock = new FrozenClock(epoch);
    const healthChanges: string[] = [];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(responseFor([rawOmm(1)]))
      .mockResolvedValueOnce(responseFor([rawOmm(2)]))
      .mockResolvedValueOnce(responseFor([rawOmm(3)]))
      .mockResolvedValueOnce(responseFor([rawOmm(4)]))
      .mockRejectedValue(new Error('upstream unavailable'));
    const adapter = new SatelliteAdapter({
      clock,
      seedMode: false,
      liveMode: true,
      liveAccessEnabled: true,
      termsApproved: true,
      fetcher,
      onHealthChange: (health) => healthChanges.push(health),
    });
    await adapter.getCatalog();

    clock.setTime(epoch + 3 * 60 * 60 * 1_000);
    expect((await adapter.getCatalog()).provenance.mode).toBe('cached');
    expect(healthChanges.at(-1)).toBe('degraded');
    clock.setTime(epoch + 25 * 60 * 60 * 1_000);
    await expect(adapter.getCatalog()).rejects.toThrow(/upstream unavailable/);
    expect(healthChanges.at(-1)).toBe('unavailable');
  });

  it('retries an initial transient failure after a short backoff, not the two-hour cache TTL', async () => {
    const clock = new FrozenClock(epoch);
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary DNS failure'))
      .mockResolvedValue(responseFor([rawOmm(1)]));
    const adapter = new SatelliteAdapter({
      clock,
      seedMode: false,
      liveMode: true,
      liveAccessEnabled: true,
      termsApproved: true,
      groups: ['STATIONS'],
      fetcher,
    });

    await expect(adapter.getCatalog()).rejects.toThrow(/temporary DNS failure/);
    await expect(adapter.getCatalog()).rejects.toThrow(/retry backoff/);
    expect(fetcher).toHaveBeenCalledTimes(1);

    clock.setTime(epoch + SATELLITE_TRANSIENT_RETRY_SECONDS * 1_000);
    await expect(adapter.getCatalog()).resolves.toMatchObject({ elements: [{ catalog_id: '1' }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not hammer terminal upstream responses during the two-hour source window', async () => {
    const clock = new FrozenClock(epoch);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => '',
      })
      .mockResolvedValue(responseFor([rawOmm(1)]));
    const adapter = new SatelliteAdapter({
      clock,
      seedMode: false,
      liveMode: true,
      liveAccessEnabled: true,
      termsApproved: true,
      groups: ['STATIONS'],
      fetcher,
    });

    await expect(adapter.getCatalog()).rejects.toThrow(/HTTP 403/);
    clock.setTime(epoch + SATELLITE_TRANSIENT_RETRY_SECONDS * 1_000);
    await expect(adapter.getCatalog()).rejects.toThrow(/retry backoff/);
    expect(fetcher).toHaveBeenCalledTimes(1);

    clock.setTime(epoch + SATELLITE_CACHE_FRESH_SECONDS * 1_000);
    await expect(adapter.getCatalog()).resolves.toMatchObject({ elements: [{ catalog_id: '1' }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps redirect rejection on the fixed host under the terminal two-hour hold', async () => {
    const clock = new FrozenClock(epoch);
    const redirectError = Object.assign(new TypeError('fetch failed'), {
      cause: new Error('redirect mode is set to error'),
    });
    const fetcher = vi.fn().mockRejectedValue(redirectError);
    const adapter = new SatelliteAdapter({
      clock,
      seedMode: false,
      liveMode: true,
      liveAccessEnabled: true,
      termsApproved: true,
      groups: ['STATIONS'],
      fetcher,
    });

    await expect(adapter.getCatalog()).rejects.toThrow(/fetch failed/);
    clock.setTime(epoch + SATELLITE_TRANSIENT_RETRY_SECONDS * 1_000);
    await expect(adapter.getCatalog()).rejects.toThrow(/retry backoff/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('normalizes a CelesTrak UTC epoch that omits the Z suffix', async () => {
    const adapter = new SatelliteAdapter({
      clock: new FrozenClock(epoch),
      seedMode: false,
      liveMode: true,
      liveAccessEnabled: true,
      termsApproved: true,
      groups: ['STATIONS'],
      fetcher: async () => responseFor([{ ...rawOmm(1), EPOCH: '2026-09-04T12:00:00.000000' }]),
    });
    expect((await adapter.getCatalog()).elements[0]?.element_epoch).toBe(
      '2026-09-04T12:00:00.000Z'
    );
  });

  it('fails closed on malformed upstream OMM without exposing a partial catalog', async () => {
    const adapter = new SatelliteAdapter({
      clock: new FrozenClock(epoch),
      seedMode: false,
      liveMode: true,
      liveAccessEnabled: true,
      termsApproved: true,
      groups: ['STATIONS'],
      fetcher: async () => responseFor([{ ...rawOmm(1), ECCENTRICITY: 1 }]),
    });
    await expect(adapter.getCatalog()).rejects.toThrow();
  });
});
