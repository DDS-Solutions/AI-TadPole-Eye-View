import fs from 'node:fs';
import type { BikeStation, BikeStationBatch, BoundingBox } from '@gev/contracts';
import { BikeStationBatch as BikeStationBatchSchema } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { pinnedFetch } from '@gev/security';
import { resolveFixturePath } from './opensky.js';

export interface GbfsAdapterOptions {
  clock?: SimClock;
  seedFixturePath?: string;
  seedMode?: boolean;
  liveMode?: boolean;
  stationInfoUrl?: string;
  stationStatusUrl?: string;
}

/**
 * GBFS Bikeshare Provider Adapter
 */
export class GbfsAdapter {
  private readonly clock: SimClock;
  private readonly seedFixturePath: string;
  private readonly isSeedMode: boolean;
  private readonly stationInfoUrl: string;
  private readonly stationStatusUrl: string;

  constructor(options: GbfsAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.seedFixturePath = options.seedFixturePath ?? resolveFixturePath('gbfs-stations.json');
    this.isSeedMode = options.liveMode
      ? false
      : (options.seedMode ??
        (process.env.GEV_SEED_MODE === '1' ||
          process.env.GEV_LIVE_MODE !== '1' ||
          process.env.NODE_ENV === 'test'));
    this.stationInfoUrl =
      options.stationInfoUrl ?? 'https://gbfs.baywheels.com/gbfs/en/station_information.json';
    this.stationStatusUrl =
      options.stationStatusUrl ?? 'https://gbfs.baywheels.com/gbfs/en/station_status.json';
  }

  async getStations(bbox?: BoundingBox): Promise<BikeStationBatch> {
    if (this.isSeedMode) {
      return this.replaySeedFixture(bbox);
    }
    return this.fetchLiveStations(bbox);
  }

  private async replaySeedFixture(bbox?: BoundingBox): Promise<BikeStationBatch> {
    if (!fs.existsSync(this.seedFixturePath)) {
      throw new Error(`GBFS seed fixture file not found at: ${this.seedFixturePath}`);
    }

    const content = await fs.promises.readFile(this.seedFixturePath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = BikeStationBatchSchema.parse(parsed);

    if (!bbox) {
      return validated;
    }

    const filtered = validated.stations.filter((s) => {
      return (
        s.latitude >= bbox.min_lat &&
        s.latitude <= bbox.max_lat &&
        s.longitude >= bbox.min_lon &&
        s.longitude <= bbox.max_lon
      );
    });

    return {
      time: Math.floor(this.clock.now() / 1000),
      system_id: validated.system_id,
      stations: filtered,
    };
  }

  private async fetchLiveStations(bbox?: BoundingBox): Promise<BikeStationBatch> {
    const infoUrl = new URL(this.stationInfoUrl);
    const infoRes = await pinnedFetch(infoUrl, {
      headers: { Accept: 'application/json' },
      allowedHosts: ['gbfs.baywheels.com', 'gbfs.citibikenyc.com'],
      allowedPaths: [
        { host: 'gbfs.baywheels.com', pathPrefix: '/gbfs/' },
        { host: 'gbfs.citibikenyc.com', pathPrefix: '/gbfs/' },
      ],
      timeoutMs: 10000,
      maxBytes: 5 * 1024 * 1024,
    });

    if (!infoRes.ok) {
      throw new Error(`GBFS station info returned HTTP ${infoRes.status}`);
    }

    const statusUrl = new URL(this.stationStatusUrl);
    const statusRes = await pinnedFetch(statusUrl, {
      headers: { Accept: 'application/json' },
      allowedHosts: ['gbfs.baywheels.com', 'gbfs.citibikenyc.com'],
      allowedPaths: [
        { host: 'gbfs.baywheels.com', pathPrefix: '/gbfs/' },
        { host: 'gbfs.citibikenyc.com', pathPrefix: '/gbfs/' },
      ],
      timeoutMs: 10000,
      maxBytes: 5 * 1024 * 1024,
    });

    if (!statusRes.ok) {
      throw new Error(`GBFS station status returned HTTP ${statusRes.status}`);
    }

    const infoJson = (await infoRes.json()) as {
      data: {
        stations: Array<{
          station_id: string;
          name: string;
          lat: number;
          lon: number;
          capacity?: number;
        }>;
      };
    };
    const statusJson = (await statusRes.json()) as {
      data: {
        stations: Array<{
          station_id: string;
          num_bikes_available?: number;
          num_docks_available?: number;
          is_installed?: number;
          is_renting?: number;
          is_returning?: number;
        }>;
      };
    };

    const statusMap = new Map<
      string,
      {
        num_bikes_available: number;
        num_docks_available: number;
        is_installed: boolean;
        is_renting: boolean;
        is_returning: boolean;
      }
    >();
    for (const st of statusJson.data?.stations || []) {
      statusMap.set(st.station_id, {
        num_bikes_available: st.num_bikes_available ?? 0,
        num_docks_available: st.num_docks_available ?? 0,
        is_installed: Boolean(st.is_installed ?? 1),
        is_renting: Boolean(st.is_renting ?? 1),
        is_returning: Boolean(st.is_returning ?? 1),
      });
    }

    const stations: BikeStation[] = [];
    for (const info of infoJson.data?.stations || []) {
      if (bbox) {
        if (
          info.lat < bbox.min_lat ||
          info.lat > bbox.max_lat ||
          info.lon < bbox.min_lon ||
          info.lon > bbox.max_lon
        ) {
          continue;
        }
      }

      const st = statusMap.get(info.station_id) || {
        num_bikes_available: 0,
        num_docks_available: 0,
        is_installed: true,
        is_renting: true,
        is_returning: true,
      };

      stations.push({
        station_id: info.station_id,
        name: info.name,
        latitude: info.lat,
        longitude: info.lon,
        capacity: info.capacity ?? 0,
        ...st,
      });
    }

    return {
      time: Math.floor(this.clock.now() / 1000),
      system_id: 'gbfs',
      stations,
    };
  }
}
