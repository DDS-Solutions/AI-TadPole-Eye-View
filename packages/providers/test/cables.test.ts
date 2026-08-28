import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { CablePackLoader, downloadCablePack, loadSyntheticCablePack } from '../src/cables.js';

describe('Submarine Cable Pack Loader & Licensing Hygiene (PLAN.md §5 & §10)', () => {
  it('loads synthetic seed pack with clean MIT / CC0 non-copyrighted topology', () => {
    const clock = new FrozenClock(1_700_000_000_000);
    const catalog = loadSyntheticCablePack(clock);

    expect(catalog.source).toBe('synthetic_seed');
    expect(catalog.license).toContain('MIT / CC0');
    expect(catalog.cables.length).toBeGreaterThanOrEqual(3);
    expect(catalog.timestamp).toBe(clock.now());

    for (const cable of catalog.cables) {
      expect(cable.id).toBeDefined();
      expect(cable.name).toBeDefined();
      expect(cable.landing_points.length).toBeGreaterThan(0);
      expect(cable.coordinates.length).toBeGreaterThan(0);
    }
  });

  it('rejects live NC cable download when operator license agreement is missing', async () => {
    await expect(
      downloadCablePack({
        licenseAccepted: false,
      })
    ).rejects.toThrow(/explicit runtime license agreement/i);

    const clock = new FrozenClock(1_700_000_000_000);
    const loader = new CablePackLoader({ licenseAccepted: false }, clock);
    await expect(loader.downloadPack()).rejects.toThrow(/explicit runtime license agreement/i);
    expect(loader.loadSyntheticSeedPack().source).toBe('synthetic_seed');
    expect(loader.loadSyntheticSeedPack().timestamp).toBe(clock.now());
  });
});
