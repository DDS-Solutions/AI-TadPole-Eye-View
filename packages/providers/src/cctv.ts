import fs from 'node:fs';
import {
  type BoundingBox,
  type CctvCamera,
  type CctvCatalog,
  type CctvCatalogPayload,
  CctvCatalogPayload as CctvCatalogPayloadSchema,
  CctvCatalog as CctvCatalogSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { resolveFixturePath } from './opensky.js';
import { createDataProvenance, observationPeriodFromUnixSeconds } from './provenance.js';

export interface CctvAdapterOptions {
  clock?: SimClock;
  seedFixturePath?: string;
  seedMode?: boolean;
  liveMode?: boolean;
}

/**
 * CCTV / Traffic Camera Provider Adapter
 */
export class CctvAdapter {
  private readonly clock: SimClock;
  private readonly seedFixturePath: string;
  private readonly isSeedMode: boolean;
  private cachedCatalog?: CctvCatalogPayload;

  constructor(options: CctvAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.seedFixturePath = options.seedFixturePath ?? resolveFixturePath('cctv-cameras.json');
    this.isSeedMode = options.liveMode
      ? false
      : (options.seedMode ??
        (process.env.GEV_SEED_MODE === '1' ||
          process.env.GEV_LIVE_MODE !== '1' ||
          process.env.NODE_ENV === 'test'));
  }

  /**
   * Retrieves all available CCTV cameras, optionally filtered by agency or bounding box.
   */
  async getCatalog(agency?: string, bbox?: BoundingBox): Promise<CctvCatalog> {
    const raw = await this.loadCatalog();

    let filtered = raw.cameras;
    if (agency) {
      filtered = filtered.filter((c) => c.agency.toLowerCase().includes(agency.toLowerCase()));
    }

    if (bbox) {
      filtered = filtered.filter((c) => {
        return (
          c.latitude >= bbox.min_lat &&
          c.latitude <= bbox.max_lat &&
          c.longitude >= bbox.min_lon &&
          c.longitude <= bbox.max_lon
        );
      });
    }

    return CctvCatalogSchema.parse({
      time: raw.time,
      count: filtered.length,
      cameras: filtered,
      provenance: createDataProvenance({
        providerId: 'dot-traffic',
        feedId: 'cctv',
        clock: this.clock,
        sourceMode: 'seed',
        observationPeriod: observationPeriodFromUnixSeconds(raw.time),
        fixtureId: 'cctv-cameras-v1',
      }),
    });
  }

  /**
   * Looks up an individual camera by ID.
   */
  async getCamera(id: string): Promise<CctvCamera | null> {
    const catalog = await this.loadCatalog();
    return catalog.cameras.find((c) => c.id === id) ?? null;
  }

  private async loadCatalog(): Promise<CctvCatalogPayload> {
    if (this.cachedCatalog && this.isSeedMode) {
      return this.cachedCatalog;
    }

    if (!fs.existsSync(this.seedFixturePath)) {
      throw new Error(`CCTV catalog fixture not found at: ${this.seedFixturePath}`);
    }

    const content = await fs.promises.readFile(this.seedFixturePath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = CctvCatalogPayloadSchema.parse(parsed);

    this.cachedCatalog = validated;
    return validated;
  }
}
