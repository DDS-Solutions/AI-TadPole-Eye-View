import fs from 'node:fs';
import type { WeatherCollection } from '@gev/contracts';
import { WeatherCollection as WeatherCollectionSchema } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { resolveFixturePath } from './opensky.js';

export interface WeatherAdapterOptions {
  clock?: SimClock;
  seedFixturePath?: string;
  seedMode?: boolean;
}

/**
 * Global Weather Radar & Meteorological Observations Provider Adapter (PLAN.md §8 Layer 9)
 */
export class WeatherAdapter {
  private readonly clock: SimClock;
  private readonly seedFixturePath: string;

  constructor(options: WeatherAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.seedFixturePath = options.seedFixturePath ?? resolveFixturePath('weather-radar.json');
  }

  /**
   * Retrieves weather radar frames and meteorological observations.
   */
  async getWeather(): Promise<WeatherCollection> {
    if (!fs.existsSync(this.seedFixturePath)) {
      throw new Error(`Weather seed fixture file not found at: ${this.seedFixturePath}`);
    }

    const content = await fs.promises.readFile(this.seedFixturePath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = WeatherCollectionSchema.parse(parsed);

    return {
      time: Math.floor(this.clock.now() / 1000),
      count: validated.stations.length,
      radar_frames: validated.radar_frames,
      radar_tile_template: validated.radar_tile_template,
      stations: validated.stations,
    };
  }
}
