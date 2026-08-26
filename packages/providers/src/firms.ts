import fs from 'node:fs';
import type { BoundingBox, ThermalHotspot, ThermalHotspotBatch } from '@gev/contracts';
import { ThermalHotspotBatch as ThermalHotspotBatchSchema } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { pinnedFetch } from '@gev/security';
import { resolveFixturePath } from './opensky.js';

export interface FirmsAdapterOptions {
  clock?: SimClock;
  seedFixturePath?: string;
  seedMode?: boolean;
  liveMode?: boolean;
  mapKey?: string;
}

/**
 * NASA FIRMS Thermal Hotspot / Wildfire Provider Adapter
 */
export class FirmsAdapter {
  private readonly clock: SimClock;
  private readonly seedFixturePath: string;
  private readonly isSeedMode: boolean;
  private readonly mapKey?: string;

  constructor(options: FirmsAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.seedFixturePath = options.seedFixturePath ?? resolveFixturePath('firms-hotspots.json');
    this.isSeedMode = options.liveMode
      ? false
      : (options.seedMode ??
        (process.env.GEV_SEED_MODE === '1' ||
          process.env.GEV_LIVE_MODE !== '1' ||
          process.env.NODE_ENV === 'test'));
    this.mapKey = options.mapKey ?? process.env.FIRMS_MAP_KEY;
  }

  async getHotspots(bbox?: BoundingBox): Promise<ThermalHotspotBatch> {
    if (this.isSeedMode) {
      return this.replaySeedFixture(bbox);
    }
    return this.fetchLiveHotspots(bbox);
  }

  private async replaySeedFixture(bbox?: BoundingBox): Promise<ThermalHotspotBatch> {
    if (!fs.existsSync(this.seedFixturePath)) {
      throw new Error(`FIRMS seed fixture file not found at: ${this.seedFixturePath}`);
    }

    const content = await fs.promises.readFile(this.seedFixturePath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = ThermalHotspotBatchSchema.parse(parsed);

    if (!bbox) {
      return validated;
    }

    const filtered = validated.hotspots.filter((h) => {
      return (
        h.latitude >= bbox.min_lat &&
        h.latitude <= bbox.max_lat &&
        h.longitude >= bbox.min_lon &&
        h.longitude <= bbox.max_lon
      );
    });

    return {
      time: Math.floor(this.clock.now() / 1000),
      count: filtered.length,
      hotspots: filtered,
    };
  }

  private async fetchLiveHotspots(bbox?: BoundingBox): Promise<ThermalHotspotBatch> {
    const key = this.mapKey || 'demo_key';
    const source = 'VIIRS_SNPP_NRT';
    const area = bbox ? `${bbox.min_lon},${bbox.min_lat},${bbox.max_lon},${bbox.max_lat}` : 'world';
    const url = new URL(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${area}/1`
    );

    const response = await pinnedFetch(url, {
      headers: { Accept: 'text/csv' },
      allowedHosts: ['firms.modaps.eosdis.nasa.gov'],
      allowedPaths: [{ host: 'firms.modaps.eosdis.nasa.gov', pathPrefix: '/api/area/csv/' }],
      timeoutMs: 15000,
      maxBytes: 15 * 1024 * 1024,
    });

    if (!response.ok) {
      throw new Error(`NASA FIRMS API returned HTTP ${response.status}: ${response.statusText}`);
    }

    const csvText = await response.text();
    const hotspots = this.parseCsv(csvText);

    return {
      time: Math.floor(this.clock.now() / 1000),
      count: hotspots.length,
      hotspots,
    };
  }

  private parseCsv(csv: string): ThermalHotspot[] {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0]?.split(',').map((h) => h.trim().toLowerCase()) || [];
    const latIdx = headers.indexOf('latitude');
    const lonIdx = headers.indexOf('longitude');
    const brightIdx =
      headers.indexOf('bright_ti4') !== -1
        ? headers.indexOf('bright_ti4')
        : headers.indexOf('brightness');
    const frpIdx = headers.indexOf('frp');
    const dateIdx = headers.indexOf('acq_date');
    const timeIdx = headers.indexOf('acq_time');
    const satelliteIdx = headers.indexOf('satellite');
    const confidenceIdx = headers.indexOf('confidence');
    const daynightIdx = headers.indexOf('daynight');

    const results: ThermalHotspot[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const parts = line.split(',');

      const lat = Number.parseFloat(parts[latIdx] || '');
      const lon = Number.parseFloat(parts[lonIdx] || '');
      if (Number.isNaN(lat) || Number.isNaN(lon)) continue;

      results.push({
        id: `firms-${i}-${Date.now()}`,
        latitude: lat,
        longitude: lon,
        brightness_kelvin: Number.parseFloat(parts[brightIdx] || '300') || 300,
        frp_mw: Number.parseFloat(parts[frpIdx] || '0') || 0,
        satellite: parts[satelliteIdx] || 'VIIRS_SNPP',
        confidence: parts[confidenceIdx] || 'nominal',
        acq_date: parts[dateIdx] || new Date(this.clock.now()).toISOString().split('T')[0] || '',
        acq_time: parts[timeIdx] || '1200',
        daynight: parts[daynightIdx] === 'N' ? 'N' : 'D',
      });
    }

    return results;
  }
}
