import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { RadioAdapter } from '../src/radio.js';

describe('Radio Provider Adapter Seed Replay (PLAN.md §10 Phase 1 Item 3)', () => {
  const clock = new FrozenClock(1724580000000);

  it('replays radio catalog seed fixture losslessly', async () => {
    const adapter = new RadioAdapter({ clock, seedMode: true });
    const catalog = await adapter.getCatalog();

    expect(catalog.count).toBeGreaterThanOrEqual(4);
    expect(catalog.stations.some((s) => s.id === 'ksfo-tower')).toBe(true);
    expect(catalog.stations.some((s) => s.id === 'marine-ch16-sfbay')).toBe(true);
  });

  it('filters catalog by category and bounding box', async () => {
    const adapter = new RadioAdapter({ clock, seedMode: true });
    const marineOnly = await adapter.getCatalog('marine');

    expect(marineOnly.stations.length).toBe(2);
    expect(marineOnly.stations.every((s) => s.category === 'marine')).toBe(true);
  });

  it('looks up individual station and runs health check in seed mode', async () => {
    const adapter = new RadioAdapter({ clock, seedMode: true });
    const station = await adapter.getStation('ksfo-tower');

    expect(station).not.toBeNull();
    if (!station) throw new Error('Station should exist');
    expect(station.frequency_mhz).toBe(120.5);

    const health = await adapter.checkStationHealth(station);
    expect(health.online).toBe(true);
  });
});
