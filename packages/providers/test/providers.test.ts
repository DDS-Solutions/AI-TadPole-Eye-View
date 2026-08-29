import net from 'node:net';
import { FrozenClock, SteppableClock } from '@gev/core';
import { describe, expect, it, vi } from 'vitest';
import { AisAdapter } from '../src/ais.js';
import { CctvAdapter } from '../src/cctv.js';
import { FirmsAdapter } from '../src/firms.js';
import { GbfsAdapter } from '../src/gbfs.js';
import { LaunchAdapter } from '../src/launches.js';
import { OpenSkyAdapter } from '../src/opensky.js';
import { RadioAdapter } from '../src/radio.js';
import { UsgsQuakeAdapter } from '../src/usgs.js';
import { WeatherAdapter } from '../src/weather.js';

describe('Provider Adapters Seed Replay (PLAN.md §10 Phase 1)', () => {
  const clock = new FrozenClock(1724580000000);

  it('AisAdapter: parses ships seed fixture losslessly with bbox filtering', async () => {
    const adapter = new AisAdapter({ clock, seedMode: true });
    const batch = await adapter.getShips();

    expect(batch.ships.length).toBeGreaterThanOrEqual(4);
    expect(batch.ships.some((s) => s.mmsi === '563048500')).toBe(true);

    const filtered = await adapter.getShips({
      min_lat: 36.0,
      max_lat: 39.0,
      min_lon: -123.0,
      max_lon: -121.0,
    });
    expect(filtered.ships.length).toBe(1);
    expect(filtered.ships[0]?.name).toBe('GOLDEN GATE FERRY');
  });

  it('UsgsQuakeAdapter: parses earthquake seed fixture with magnitude and bbox filters', async () => {
    const adapter = new UsgsQuakeAdapter({ clock, seedMode: true });
    const all = await adapter.getQuakes(2.0);
    expect(all.count).toBe(4);

    const majorOnly = await adapter.getQuakes(5.0);
    expect(majorOnly.count).toBe(2);
    expect(majorOnly.features.every((f) => f.mag >= 5.0)).toBe(true);
  });

  it('FirmsAdapter: parses thermal hotspot seed fixture with spatial filtering', async () => {
    const adapter = new FirmsAdapter({ clock, seedMode: true });
    const all = await adapter.getHotspots();
    expect(all.count).toBe(4);
    expect(all.hotspots.some((h) => h.satellite === 'VIIRS_SNPP')).toBe(true);
  });

  it('GbfsAdapter: parses bikeshare station seed fixture', async () => {
    const adapter = new GbfsAdapter({ clock, seedMode: true });
    const batch = await adapter.getStations();
    expect(batch.stations.length).toBe(3);
    expect(batch.stations.some((s) => s.station_id === 'sf-ferry-building')).toBe(true);
  });

  it('all implemented adapter responses carry registry-backed seed provenance without network access', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const socketSpy = vi.spyOn(net, 'connect');
    const responses = await Promise.all([
      new OpenSkyAdapter({ clock, seedMode: true }).getFlights(),
      new AisAdapter({ clock, seedMode: true }).getShips(),
      new UsgsQuakeAdapter({ clock, seedMode: true }).getQuakes(),
      new FirmsAdapter({ clock, seedMode: true }).getHotspots(),
      new GbfsAdapter({ clock, seedMode: true }).getStations(),
      new CctvAdapter({ clock }).getCatalog(),
      new RadioAdapter({ clock }).getCatalog(),
      new LaunchAdapter({ clock }).getLaunches(),
      new WeatherAdapter({ clock }).getWeather(),
    ]);

    for (const response of responses) {
      expect(response.provenance).toMatchObject({
        schema_version: 1,
        retrieved_at: clock.iso(),
        mode: 'seed',
        source_mode: 'seed',
        cache: null,
      });
      expect(response.provenance.source.canonical_url).toMatch(/^https:\/\//);
      expect(response.provenance.license.id.length).toBeGreaterThan(0);
      expect(response.provenance.fixture_id).not.toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(socketSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    socketSpy.mockRestore();
  });

  it('advances retrieval and freshness while preserving fixture observation time', async () => {
    const stepClock = new SteppableClock(1724580000000);
    const adapter = new CctvAdapter({ clock: stepClock });
    const first = await adapter.getCatalog();

    stepClock.tick(11_000);
    const second = await adapter.getCatalog();

    expect(second.time).toBe(first.time);
    expect(second.provenance.observation_period).toEqual(first.provenance.observation_period);
    expect(second.provenance.retrieved_at).not.toBe(first.provenance.retrieved_at);
    expect(first.provenance.freshness.status).toBe('fresh');
    expect(second.provenance.freshness.status).toBe('stale');
  });
});
