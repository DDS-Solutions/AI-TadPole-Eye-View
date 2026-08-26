import fs from 'node:fs';
import type { BoundingBox, RadioCatalog, RadioCategory, RadioStation } from '@gev/contracts';
import { RadioCatalog as RadioCatalogSchema } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { pinnedFetch } from '@gev/security';
import { resolveFixturePath } from './opensky.js';

export interface RadioAdapterOptions {
  clock?: SimClock;
  seedFixturePath?: string;
  seedMode?: boolean;
  liveMode?: boolean;
}

/**
 * Radio & ATC Audio Stream Provider Adapter
 */
export class RadioAdapter {
  private readonly clock: SimClock;
  private readonly seedFixturePath: string;
  private readonly isSeedMode: boolean;
  private cachedCatalog?: RadioCatalog;

  constructor(options: RadioAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.seedFixturePath = options.seedFixturePath ?? resolveFixturePath('radio-catalog.json');
    this.isSeedMode = options.liveMode
      ? false
      : (options.seedMode ??
        (process.env.GEV_SEED_MODE === '1' ||
          process.env.GEV_LIVE_MODE !== '1' ||
          process.env.NODE_ENV === 'test'));
  }

  /**
   * Retrieves all available radio stations, optionally filtered by category and spatial bounds.
   */
  async getCatalog(category?: RadioCategory, bbox?: BoundingBox): Promise<RadioCatalog> {
    const rawCatalog = await this.loadCatalog();

    let filtered = rawCatalog.stations;
    if (category) {
      filtered = filtered.filter((s) => s.category === category);
    }

    if (bbox) {
      filtered = filtered.filter((s) => {
        return (
          s.latitude >= bbox.min_lat &&
          s.latitude <= bbox.max_lat &&
          s.longitude >= bbox.min_lon &&
          s.longitude <= bbox.max_lon
        );
      });
    }

    return {
      time: Math.floor(this.clock.now() / 1000),
      count: filtered.length,
      stations: filtered,
    };
  }

  /**
   * Looks up a specific station by its unique ID.
   */
  async getStation(id: string): Promise<RadioStation | null> {
    const catalog = await this.loadCatalog();
    return catalog.stations.find((s) => s.id === id) ?? null;
  }

  /**
   * Performs an active health check on a radio stream URL.
   */
  async checkStationHealth(station: RadioStation): Promise<{ online: boolean; latencyMs: number }> {
    if (this.isSeedMode) {
      return { online: station.status === 'online', latencyMs: 2 };
    }

    const startTime = this.clock.now();
    try {
      const url = new URL(station.stream_url);
      const res = await pinnedFetch(url, {
        method: 'HEAD',
        allowedHosts: ['audio.broadcastify.com', 'liveatc.net', 'radio-browser.info'],
        timeoutMs: 5000,
      });

      const latencyMs = this.clock.now() - startTime;
      return {
        online: res.ok || res.status === 302,
        latencyMs,
      };
    } catch {
      return { online: false, latencyMs: this.clock.now() - startTime };
    }
  }

  private async loadCatalog(): Promise<RadioCatalog> {
    if (this.cachedCatalog && this.isSeedMode) {
      return this.cachedCatalog;
    }

    if (!fs.existsSync(this.seedFixturePath)) {
      throw new Error(`Radio catalog fixture not found at: ${this.seedFixturePath}`);
    }

    const content = await fs.promises.readFile(this.seedFixturePath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = RadioCatalogSchema.parse(parsed);

    this.cachedCatalog = validated;
    return validated;
  }
}
