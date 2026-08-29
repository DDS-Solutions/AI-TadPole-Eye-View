import fs from 'node:fs';
import {
  type BoundingBox,
  type EarthquakeCollection,
  EarthquakeCollectionPayload as EarthquakeCollectionPayloadSchema,
  EarthquakeCollection as EarthquakeCollectionSchema,
  type EarthquakeFeature,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { pinnedFetch } from '@gev/security';
import { z } from 'zod';
import { resolveFixturePath } from './opensky.js';
import { createDataProvenance, observationPeriodFromUnixSeconds } from './provenance.js';

const RawUsgsFeatureSchema = z.object({
  id: z.string().min(1),
  properties: z.object({
    mag: z.number().finite(),
    place: z.string(),
    time: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative().optional(),
    sig: z.number().finite().nonnegative(),
    alert: z.enum(['green', 'yellow', 'orange', 'red']).nullable().optional(),
    tsunami: z.number().int().optional(),
    status: z.string().optional(),
  }),
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number(), z.number()]) }),
});

const RawUsgsResponseSchema = z.object({
  metadata: z.object({ generated: z.number().int().nonnegative() }).passthrough(),
  features: z.array(RawUsgsFeatureSchema),
});

export interface UsgsAdapterOptions {
  clock?: SimClock;
  seedFixturePath?: string;
  seedMode?: boolean;
  liveMode?: boolean;
}

/**
 * USGS Real-time Earthquake Provider Adapter
 */
export class UsgsQuakeAdapter {
  private readonly clock: SimClock;
  private readonly seedFixturePath: string;
  private readonly isSeedMode: boolean;

  constructor(options: UsgsAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.seedFixturePath = options.seedFixturePath ?? resolveFixturePath('quakes-usgs.json');
    this.isSeedMode = options.liveMode
      ? false
      : (options.seedMode ??
        (process.env.GEV_SEED_MODE === '1' ||
          process.env.GEV_LIVE_MODE !== '1' ||
          process.env.NODE_ENV === 'test'));
  }

  /**
   * Fetches earthquake events. Replays deterministic fixtures in seed mode.
   */
  async getQuakes(minMagnitude = 2.5, bbox?: BoundingBox): Promise<EarthquakeCollection> {
    if (this.isSeedMode) {
      return this.replaySeedFixture(minMagnitude, bbox);
    }
    return this.fetchLiveQuakes(minMagnitude, bbox);
  }

  private async replaySeedFixture(
    minMagnitude: number,
    bbox?: BoundingBox
  ): Promise<EarthquakeCollection> {
    if (!fs.existsSync(this.seedFixturePath)) {
      throw new Error(`USGS seed fixture file not found at: ${this.seedFixturePath}`);
    }

    const content = await fs.promises.readFile(this.seedFixturePath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = EarthquakeCollectionPayloadSchema.parse(parsed);

    const filtered = validated.features.filter((f) => {
      if (f.mag < minMagnitude) return false;
      if (bbox) {
        return (
          f.latitude >= bbox.min_lat &&
          f.latitude <= bbox.max_lat &&
          f.longitude >= bbox.min_lon &&
          f.longitude <= bbox.max_lon
        );
      }
      return true;
    });

    return EarthquakeCollectionSchema.parse({
      time: validated.time,
      count: filtered.length,
      features: filtered,
      provenance: createDataProvenance({
        providerId: 'usgs',
        feedId: 'quakes',
        clock: this.clock,
        sourceMode: 'seed',
        observationPeriod: observationPeriodFromUnixSeconds(validated.time),
        fixtureId: 'quakes-usgs-v1',
      }),
    });
  }

  private async fetchLiveQuakes(
    minMagnitude: number,
    bbox?: BoundingBox
  ): Promise<EarthquakeCollection> {
    const url = new URL(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'
    );
    const response = await pinnedFetch(url, {
      headers: { Accept: 'application/json' },
      allowedHosts: ['earthquake.usgs.gov'],
      allowedPaths: [{ host: 'earthquake.usgs.gov', pathPrefix: '/earthquakes/feed/' }],
      timeoutMs: 10000,
      maxBytes: 10 * 1024 * 1024,
    });

    if (!response.ok) {
      throw new Error(`USGS API returned HTTP ${response.status}: ${response.statusText}`);
    }

    const rawJson = RawUsgsResponseSchema.parse(await response.json());

    const features: EarthquakeFeature[] = (rawJson.features || [])
      .filter((f) => {
        const [lon, lat] = f.geometry.coordinates;
        if (f.properties.mag < minMagnitude) return false;
        if (bbox && lon !== undefined && lat !== undefined) {
          return (
            lat >= bbox.min_lat && lat <= bbox.max_lat && lon >= bbox.min_lon && lon <= bbox.max_lon
          );
        }
        return true;
      })
      .map((f) => {
        const [lon, lat, depth] = f.geometry.coordinates;
        return {
          id: f.id,
          mag: f.properties.mag,
          place: f.properties.place || 'Unknown',
          time: f.properties.time,
          updated: f.properties.updated,
          longitude: lon ?? 0,
          latitude: lat ?? 0,
          depth_km: depth ?? 10,
          significance: f.properties.sig ?? 0,
          alert: f.properties.alert,
          tsunami: f.properties.tsunami ?? 0,
          status: f.properties.status ?? 'reviewed',
        };
      });

    const observationTime = Math.floor(rawJson.metadata.generated / 1000);
    return EarthquakeCollectionSchema.parse({
      time: observationTime,
      count: features.length,
      features,
      provenance: createDataProvenance({
        providerId: 'usgs',
        feedId: 'quakes',
        clock: this.clock,
        sourceMode: 'live',
        observationPeriod: observationPeriodFromUnixSeconds(observationTime),
      }),
    });
  }
}
