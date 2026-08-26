import fs from 'node:fs';
import type { BoundingBox, ShipBatch } from '@gev/contracts';
import { ShipBatch as ShipBatchSchema } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { pinnedFetch } from '@gev/security';
import { resolveFixturePath } from './opensky.js';

export interface AisAdapterOptions {
  clock?: SimClock;
  seedFixturePath?: string;
  seedMode?: boolean;
  liveMode?: boolean;
  apiKey?: string;
}

/**
 * AIS Marine Telemetry Provider Adapter
 */
export class AisAdapter {
  private readonly clock: SimClock;
  private readonly seedFixturePath: string;
  private readonly isSeedMode: boolean;
  private readonly apiKey?: string;

  constructor(options: AisAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.seedFixturePath = options.seedFixturePath ?? resolveFixturePath('ships-ais.json');
    this.isSeedMode = options.liveMode
      ? false
      : (options.seedMode ??
        (process.env.GEV_SEED_MODE === '1' ||
          process.env.GEV_LIVE_MODE !== '1' ||
          process.env.NODE_ENV === 'test'));
    this.apiKey = options.apiKey ?? process.env.AISSTREAM_API_KEY;
  }

  /**
   * Fetches AIS vessel telemetry. Replays deterministic fixtures in seed mode.
   */
  async getShips(bbox?: BoundingBox): Promise<ShipBatch> {
    if (this.isSeedMode) {
      return this.replaySeedFixture(bbox);
    }
    return this.fetchLiveShips(bbox);
  }

  /**
   * Replays recorded seed fixture with bounding box spatial filtering.
   */
  private async replaySeedFixture(bbox?: BoundingBox): Promise<ShipBatch> {
    if (!fs.existsSync(this.seedFixturePath)) {
      throw new Error(`AIS seed fixture file not found at: ${this.seedFixturePath}`);
    }

    const content = await fs.promises.readFile(this.seedFixturePath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = ShipBatchSchema.parse(parsed);

    if (!bbox) {
      return validated;
    }

    const filtered = validated.ships.filter((ship) => {
      return (
        ship.latitude >= bbox.min_lat &&
        ship.latitude <= bbox.max_lat &&
        ship.longitude >= bbox.min_lon &&
        ship.longitude <= bbox.max_lon
      );
    });

    return {
      time: Math.floor(this.clock.now() / 1000),
      ships: filtered,
    };
  }

  /**
   * Live AIS fetch through pinned-fetch.
   */
  private async fetchLiveShips(bbox?: BoundingBox): Promise<ShipBatch> {
    const url = new URL('https://api.aisstream.io/v1/vessels');
    if (bbox) {
      url.searchParams.set('min_lat', bbox.min_lat.toString());
      url.searchParams.set('max_lat', bbox.max_lat.toString());
      url.searchParams.set('min_lon', bbox.min_lon.toString());
      url.searchParams.set('max_lon', bbox.max_lon.toString());
    }

    const response = await pinnedFetch(url, {
      headers: {
        Accept: 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      allowedHosts: ['api.aisstream.io'],
      allowedPaths: [{ host: 'api.aisstream.io', pathPrefix: '/v1/vessels' }],
      timeoutMs: 15000,
      maxBytes: 5 * 1024 * 1024,
    });

    if (!response.ok) {
      throw new Error(`AISStream API returned HTTP ${response.status}: ${response.statusText}`);
    }

    const rawJson = await response.json();
    return ShipBatchSchema.parse(rawJson);
  }
}
