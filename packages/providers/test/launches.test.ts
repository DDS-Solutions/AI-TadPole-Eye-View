import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { LaunchAdapter } from '../src/launches.js';

describe('LaunchAdapter (PLAN.md §8 Layer 8)', () => {
  const clock = new FrozenClock(1724580000000);

  it('parses orbital launch replays seed fixture losslessly', async () => {
    const adapter = new LaunchAdapter({ clock });
    const catalog = await adapter.getLaunches();

    expect(catalog.count).toBe(3);
    expect(catalog.missions.length).toBe(3);

    const falcon9 = catalog.missions.find((m) => m.id === 'mission-sl-g9-1');
    expect(falcon9).toBeDefined();
    expect(falcon9?.provider).toBe('SpaceX');
    expect(falcon9?.trajectory.length).toBeGreaterThanOrEqual(4);
    expect(falcon9?.is_simulated).toBe(false);

    const artemis = catalog.missions.find((m) => m.id === 'mission-artemis-1');
    expect(artemis?.is_simulated).toBe(true);
  });
});
