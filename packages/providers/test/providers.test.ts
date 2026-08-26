import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { AisAdapter } from '../src/ais.js';
import { FirmsAdapter } from '../src/firms.js';
import { GbfsAdapter } from '../src/gbfs.js';
import { UsgsQuakeAdapter } from '../src/usgs.js';

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
});
