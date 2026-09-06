import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OperationalAoi } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { describe, expect, it, vi } from 'vitest';
import { AviationWeatherAdapter } from '../src/aviationWeather.js';
import { CoastalConditionsAdapter } from '../src/coastalConditions.js';
import { NwsAlertsAdapter } from '../src/nwsAlerts.js';
import { TropicalCycloneAdapter, parseNhcGisIndex } from '../src/tropicalCyclones.js';

const referenceMs = Date.parse('2024-08-25T10:00:00.000Z');
const conus: OperationalAoi = { min_lat: 24, max_lat: 50, min_lon: -125, max_lon: -66 };
const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');

function fixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8')) as unknown;
}

describe('operational-awareness providers', () => {
  it('replays deterministic seed fixtures with provenance and zero network calls', async () => {
    const fetcher = vi.fn();
    const socketSpy = vi.spyOn(net, 'connect');
    const clock = new FrozenClock(referenceMs);
    const nws = await new NwsAlertsAdapter({ clock, seedMode: true, fetcher }).getAlerts(conus);
    const aviation = await new AviationWeatherAdapter({
      clock,
      seedMode: true,
      fetcher,
    }).getWeather(conus);
    const tropicalCyclones = await new TropicalCycloneAdapter({
      clock,
      seedMode: true,
      fetcher,
    }).getAdvisories(conus);
    const coastal = await new CoastalConditionsAdapter({
      clock,
      seedMode: true,
      fetcher,
    }).getConditions(conus);

    expect(fetcher).not.toHaveBeenCalled();
    expect(socketSpy).not.toHaveBeenCalled();
    expect(nws).toMatchObject({
      count: 2,
      provenance: { mode: 'seed', fixture_id: 'nws-alerts-synthetic-v1' },
    });
    expect(aviation.metars.count).toBe(2);
    expect(aviation.tafs.count).toBe(2);
    expect(aviation.sigmets.count).toBe(1);
    expect(aviation.metars.provenance.fixture_id).toBe('awc-metar-synthetic-v1');
    expect(tropicalCyclones).toMatchObject({
      count: 3,
      provenance: { mode: 'seed', fixture_id: 'nhc-advisories-synthetic-v1' },
    });
    const track = tropicalCyclones.advisories.find(({ product }) => product === 'track');
    expect(track).toMatchObject({
      issued_at: '2024-08-25T10:00:00.000Z',
      observation_time: '2024-08-25T10:00:00.000Z',
      valid_to: '2024-08-25T16:00:00.000Z',
    });
    expect(track?.forecast_points[0]?.valid_at).toBe('2024-08-25T10:00:00.000Z');
    expect(coastal).toMatchObject({
      count: 3,
      record_count: 8,
      provenance: { mode: 'seed', fixture_id: 'coops-coastal-synthetic-v1' },
    });
    expect(
      coastal.stations.find(({ station_id }) => station_id === '9414290')
        ?.water_level_observations[0]?.value
    ).toEqual({ status: 'unavailable', reason: 'Water level was not reported' });
    expect(coastal.stations.find(({ station_id }) => station_id === '8724580')).toMatchObject({
      datum: 'MLLW',
      units: 'metric',
      time_zone: 'gmt',
      station_time_zone_name: 'America/New_York',
    });
    socketSpy.mockRestore();
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
    const tropicalCyclones = await new TropicalCycloneAdapter({
      clock,
      seedMode: true,
    }).getAdvisories(colorado);
    const coastal = await new CoastalConditionsAdapter({ clock, seedMode: true }).getConditions(
      colorado
    );
    expect(nws.alerts.map((alert) => alert.id)).toEqual(['urn:gev:synthetic:nws-alert:co-001']);
    expect(aviation.metars.items.map((item) => item.station_id)).toEqual(['KDEN']);
    expect(aviation.tafs.items.map((item) => item.station_id)).toEqual(['KDEN']);
    expect(aviation.sigmets.count).toBe(0);
    expect(tropicalCyclones.count).toBe(0);
    expect(coastal.count).toBe(0);
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
    await expect(
      new TropicalCycloneAdapter({
        clock,
        seedMode: false,
        liveAccessEnabled: true,
        fetcher,
      }).getAdvisories(conus)
    ).rejects.toMatchObject({ code: 'TERMS_APPROVAL_REQUIRED', status: 423 });
    await expect(
      new CoastalConditionsAdapter({
        clock,
        seedMode: false,
        liveAccessEnabled: true,
        termsApproved: true,
        applicationId: '../unsafe',
        fetcher,
      }).getConditions(conus)
    ).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED', status: 423 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('expires NHC advisories and separates current observations from future predictions', async () => {
    const expiredClock = new FrozenClock(Date.parse('2024-08-25T17:00:00.000Z'));
    const tropicalCyclones = await new TropicalCycloneAdapter({
      clock: expiredClock,
      seedMode: true,
    }).getAdvisories(conus);
    const coastal = await new CoastalConditionsAdapter({
      clock: expiredClock,
      seedMode: true,
    }).getConditions(conus);

    expect(tropicalCyclones.count).toBe(0);
    expect(coastal).toMatchObject({ count: 0, record_count: 0 });
  });

  it('rejects active XML and advisory links outside the fixed NHC GIS origin', () => {
    expect(() => parseNhcGisIndex('<!DOCTYPE rss><rss/>', 'atlantic')).toThrow(
      'Active or entity-bearing XML'
    );
    const fixtureIndex = (
      fixture('nhc-advisories-synthetic-v1.json') as {
        indexes: Array<{ basin: string; xml: string }>;
      }
    ).indexes[0]?.xml;
    expect(fixtureIndex).toBeDefined();
    expect(() =>
      parseNhcGisIndex(
        (fixtureIndex as string).replace(
          'https://www.nhc.noaa.gov/gis/',
          'https://example.com/gis/'
        ),
        'atlantic'
      )
    ).toThrow('fixed same-origin GIS boundary');
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
