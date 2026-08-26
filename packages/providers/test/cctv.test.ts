import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { CctvAdapter } from '../src/cctv.js';

describe('CCTV Provider Adapter Seed Replay (PLAN.md §10 Phase 1 Item 5)', () => {
  const clock = new FrozenClock(1724580000000);

  it('replays CCTV camera catalog fixture', async () => {
    const adapter = new CctvAdapter({ clock, seedMode: true });
    const catalog = await adapter.getCatalog();

    expect(catalog.count).toBeGreaterThanOrEqual(4);
    expect(catalog.cameras.some((c) => c.id === 'caltrans-d4-baybridge')).toBe(true);
    expect(catalog.cameras.some((c) => c.agency.includes('NYCDOT'))).toBe(true);
  });

  it('filters CCTV cameras by agency and bounding box', async () => {
    const adapter = new CctvAdapter({ clock, seedMode: true });
    const nyOnly = await adapter.getCatalog('nycdot');

    expect(nyOnly.cameras.length).toBe(1);
    expect(nyOnly.cameras[0]?.id).toBe('nycdot-timessquare');
  });

  it('looks up individual camera by ID', async () => {
    const adapter = new CctvAdapter({ clock, seedMode: true });
    const camera = await adapter.getCamera('caltrans-d4-baybridge');

    expect(camera).not.toBeNull();
    expect(camera?.name).toContain('Bay Bridge');
  });
});
