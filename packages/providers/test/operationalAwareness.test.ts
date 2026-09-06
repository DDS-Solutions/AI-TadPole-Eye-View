import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OperationalAoi } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { describe, expect, it, vi } from 'vitest';
import { AviationWeatherAdapter } from '../src/aviationWeather.js';
import { NwsAlertsAdapter } from '../src/nwsAlerts.js';

const referenceMs = Date.parse('2024-08-25T10:00:00.000Z');
const conus: OperationalAoi = { min_lat: 24, max_lat: 50, min_lon: -125, max_lon: -66 };
const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');

function fixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8')) as unknown;
}

describe('operational-awareness providers', () => {
  it('replays deterministic seed fixtures with provenance and zero network calls', async () => {
    const fetcher = vi.fn();
    const clock = new FrozenClock(referenceMs);
    const nws = await new NwsAlertsAdapter({ clock, seedMode: true, fetcher }).getAlerts(conus);
    const aviation = await new AviationWeatherAdapter({
      clock,
      seedMode: true,
      fetcher,
    }).getWeather(conus);

    expect(fetcher).not.toHaveBeenCalled();
    expect(nws).toMatchObject({
      count: 2,
      provenance: { mode: 'seed', fixture_id: 'nws-alerts-synthetic-v1' },
    });
    expect(aviation.metars.count).toBe(2);
    expect(aviation.tafs.count).toBe(2);
    expect(aviation.sigmets.count).toBe(1);
    expect(aviation.metars.provenance.fixture_id).toBe('awc-metar-synthetic-v1');
  });

  it('filters every product to the validated AOI', async () => {
    const clock = new FrozenClock(referenceMs);
    const colorado: OperationalAoi = {
      min_lat: 36,
      max_lat: 42,
      min_lon: -109,
      max_lon: -102,
    };
    const nws = await new NwsAlertsAdapter({ clock, seedMode: true }).getAlerts(colorado);
    const aviation = await new AviationWeatherAdapter({ clock, seedMode: true }).getWeather(
      colorado
    );
    expect(nws.alerts.map((alert) => alert.id)).toEqual(['urn:gev:synthetic:nws-alert:co-001']);
    expect(aviation.metars.items.map((item) => item.station_id)).toEqual(['KDEN']);
    expect(aviation.tafs.items.map((item) => item.station_id)).toEqual(['KDEN']);
    expect(aviation.sigmets.count).toBe(0);
  });

  it('fails NWS closed after five stale minutes and never renders expired AWC products', async () => {
    const staleClock = new FrozenClock(referenceMs + 5 * 60_000 + 1);
    await expect(
      new NwsAlertsAdapter({ clock: staleClock, seedMode: true }).getAlerts(conus)
    ).rejects.toMatchObject({ code: 'SOURCE_STALE', status: 503 });

    const expiredClock = new FrozenClock(Date.parse('2024-08-27T12:00:00.000Z'));
    const aviation = await new AviationWeatherAdapter({
      clock: expiredClock,
      seedMode: true,
    }).getWeather(conus);
    expect(aviation.metars.count).toBe(0);
    expect(aviation.tafs.count).toBe(0);
    expect(aviation.sigmets.count).toBe(0);
  });

  it('keeps live access locked until both source gates are recorded', async () => {
    const fetcher = vi.fn();
    const clock = new FrozenClock(referenceMs);
    await expect(
      new NwsAlertsAdapter({ clock, seedMode: false, liveAccessEnabled: true, fetcher }).getAlerts(
        conus
      )
    ).rejects.toMatchObject({ code: 'TERMS_APPROVAL_REQUIRED', status: 423 });
    await expect(
      new AviationWeatherAdapter({
        clock,
        seedMode: false,
        termsApproved: true,
        fetcher,
      }).getWeather(conus)
    ).rejects.toMatchObject({ code: 'TERMS_APPROVAL_REQUIRED', status: 423 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses only fixed pinned hosts, bounded responses, and identified User-Agents in live mode', async () => {
    const clock = new FrozenClock(referenceMs);
    const nwsPayload = fixture('nws-alerts-synthetic-v1.geojson');
    const productPayloads = {
      metar: fixture('awc-metar-synthetic-v1.geojson'),
      taf: fixture('awc-taf-synthetic-v1.geojson'),
      airsigmet: fixture('awc-sigmet-synthetic-v1.geojson'),
    };
    const fetcher = vi.fn(async (url: string) => {
      const product = url.match(/\/(metar|taf|airsigmet)\?/)?.[1] as keyof typeof productPayloads;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(product ? productPayloads[product] : nwsPayload),
      };
    });

    await new NwsAlertsAdapter({
      clock,
      seedMode: false,
      liveAccessEnabled: true,
      termsApproved: true,
      userAgent: 'GEV test contact@example.com',
      fetcher,
    }).getAlerts(conus);
    await new AviationWeatherAdapter({
      clock,
      seedMode: false,
      liveAccessEnabled: true,
      termsApproved: true,
      userAgent: 'GEV deterministic test client',
      fetcher,
    }).getWeather(conus);

    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toMatch(/^https:\/\/(api\.weather\.gov|aviationweather\.gov)\//);
      expect(options.timeoutMs).toBe(10_000);
      expect(options.headers['User-Agent']).toMatch(/^GEV /);
      expect(options.allowedHosts).toHaveLength(1);
    }
  });
});
