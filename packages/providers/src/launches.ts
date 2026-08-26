import fs from 'node:fs';
import type { LaunchCatalog } from '@gev/contracts';
import { LaunchCatalog as LaunchCatalogSchema } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { resolveFixturePath } from './opensky.js';

export interface LaunchAdapterOptions {
  clock?: SimClock;
  seedFixturePath?: string;
  seedMode?: boolean;
}

/**
 * Orbital Launch Replays & Trajectories Provider Adapter (PLAN.md §8 Layer 8)
 */
export class LaunchAdapter {
  private readonly clock: SimClock;
  private readonly seedFixturePath: string;

  constructor(options: LaunchAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.seedFixturePath = options.seedFixturePath ?? resolveFixturePath('launches-catalog.json');
  }

  /**
   * Retrieves space launch missions and orbital trajectory arcs.
   */
  async getLaunches(): Promise<LaunchCatalog> {
    if (!fs.existsSync(this.seedFixturePath)) {
      throw new Error(`Launches seed fixture file not found at: ${this.seedFixturePath}`);
    }

    const content = await fs.promises.readFile(this.seedFixturePath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = LaunchCatalogSchema.parse(parsed);

    return {
      time: Math.floor(this.clock.now() / 1000),
      count: validated.missions.length,
      missions: validated.missions,
    };
  }
}
