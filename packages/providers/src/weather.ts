import fs from 'node:fs';
import {
  type WeatherCollection,
  WeatherCollectionPayload as WeatherCollectionPayloadSchema,
  WeatherCollection as WeatherCollectionSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { resolveFixturePath } from './opensky.js';
import { createDataProvenance, observationPeriodFromUnixSeconds } from './provenance.js';

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
    const validated = WeatherCollectionPayloadSchema.parse(parsed);

    return WeatherCollectionSchema.parse({
      time: validated.time,
      count: validated.stations.length,
      radar_frames: validated.radar_frames,
      radar_tile_template: validated.radar_tile_template,
      stations: validated.stations,
      provenance: createDataProvenance({
        providerId: 'rainviewer',
        feedId: 'weather',
        clock: this.clock,
        sourceMode: 'seed',
        observationPeriod: observationPeriodFromUnixSeconds(validated.time),
        fixtureId: 'weather-radar-v1',
      }),
    });
  }
}
