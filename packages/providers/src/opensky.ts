import fs from 'node:fs';
import path from 'node:path';
import type { BoundingBox, FlightBatch, FlightState, PositionSource } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { pinnedFetch } from '@gev/security';
import { z } from 'zod';

export interface OpenSkyAdapterOptions {
  clock?: SimClock;
  seedFixturePath?: string;
  seedMode?: boolean;
  liveMode?: boolean;
  credentials?: {
    username?: string;
    password?: string;
  };
}

export const RawOpenSkyVectorSchema = z.tuple([
  z.string(), // 0: icao24
  z
    .string()
    .nullable(), // 1: callsign
  z.string(), // 2: origin_country
  z
    .number()
    .nullable(), // 3: time_position
  z.number(), // 4: last_contact
  z
    .number()
    .nullable(), // 5: longitude
  z
    .number()
    .nullable(), // 6: latitude
  z
    .number()
    .nullable(), // 7: baro_altitude
  z.boolean(), // 8: on_ground
  z
    .number()
    .nullable(), // 9: velocity
  z
    .number()
    .nullable(), // 10: true_track
  z
    .number()
    .nullable(), // 11: vertical_rate
  z
    .array(z.number())
    .nullable(), // 12: sensors
  z
    .number()
    .nullable(), // 13: geo_altitude
  z
    .string()
    .nullable(), // 14: squawk
  z.boolean(), // 15: spi
  z.number(), // 16: position_source
]);
export type RawOpenSkyVector = z.infer<typeof RawOpenSkyVectorSchema>;

export const RawOpenSkyResponseSchema = z.object({
  time: z.number(),
  states: z.array(RawOpenSkyVectorSchema).nullable(),
});
export type RawOpenSkyResponse = z.infer<typeof RawOpenSkyResponseSchema>;

const POSITION_SOURCE_MAP: PositionSource[] = ['ADSB', 'ASTERIX', 'MLAT', 'FLARM'];

/**
 * Resolves fixture path robustly by checking local directory and searching upwards to workspace root.
 */
export function resolveFixturePath(fileName = 'flights-opensky.json'): string {
  let currentDir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.resolve(currentDir, 'fixtures', fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return path.resolve(process.cwd(), 'fixtures', fileName);
}

/**
 * Fast normalization of a raw OpenSky state vector array into a typed FlightState.
 */
export function normalizeOpenSkyState(raw: RawOpenSkyVector, _clock: SimClock): FlightState | null {
  const icao24 = raw[0];
  if (!icao24 || icao24.length === 0) {
    return null;
  }

  const lon = raw[5];
  const lat = raw[6];

  // Validate lat/lon bounds
  if (lon !== null && (lon < -180 || lon > 180)) {
    return null;
  }
  if (lat !== null && (lat < -90 || lat > 90)) {
    return null;
  }

  const callsign = raw[1];
  const origin_country = raw[2] || 'Unknown';
  const time_position = raw[3];
  const last_contact = raw[4] ?? 0;
  const baro_altitude = raw[7];
  const on_ground = Boolean(raw[8]);
  const velocity = raw[9];
  let true_track = raw[10];
  if (true_track !== null && true_track !== undefined) {
    if (true_track >= 360) {
      true_track = 0;
    } else if (true_track < 0) {
      true_track = null;
    }
  }

  const vertical_rate = raw[11];
  const geo_altitude = raw[13];
  const squawk = raw[14];
  const spi = Boolean(raw[15]);
  const position_source_num = raw[16];
  const position_source: PositionSource =
    typeof position_source_num === 'number' && position_source_num >= 0 && position_source_num < 4
      ? (POSITION_SOURCE_MAP[position_source_num] as PositionSource)
      : 'UNKNOWN';

  return {
    icao24: icao24.toLowerCase().trim(),
    callsign: callsign ? callsign.trim() : null,
    origin_country,
    time_position:
      time_position !== null && time_position !== undefined ? time_position : undefined,
    last_contact,
    longitude: lon,
    latitude: lat,
    baro_altitude:
      baro_altitude !== null && baro_altitude !== undefined ? baro_altitude : undefined,
    on_ground,
    velocity: velocity !== null && velocity !== undefined && velocity >= 0 ? velocity : undefined,
    true_track: true_track !== null && true_track !== undefined ? true_track : undefined,
    vertical_rate:
      vertical_rate !== null && vertical_rate !== undefined ? vertical_rate : undefined,
    geo_altitude: geo_altitude !== null && geo_altitude !== undefined ? geo_altitude : undefined,
    squawk: squawk ? squawk.trim() : undefined,
    spi,
    position_source,
  };
}

/**
 * Parses raw OpenSky response payload and filters against bounding box.
 */
export function parseOpenSkyPayload(
  payload: RawOpenSkyResponse,
  clock: SimClock,
  bbox?: BoundingBox
): FlightBatch {
  const rawStates = payload.states || [];
  const states: FlightState[] = [];

  const hasBbox = Boolean(bbox);
  const minLat = bbox?.min_lat ?? -90;
  const maxLat = bbox?.max_lat ?? 90;
  const minLon = bbox?.min_lon ?? -180;
  const maxLon = bbox?.max_lon ?? 180;

  for (let i = 0; i < rawStates.length; i++) {
    const raw = rawStates[i];
    if (!raw) continue;

    const lon = raw[5];
    const lat = raw[6];

    // Fast bounding box filtering (drops null coordinates when bounding box is requested)
    if (hasBbox) {
      if (
        lon === null ||
        lat === null ||
        lat < minLat ||
        lat > maxLat ||
        lon < minLon ||
        lon > maxLon
      ) {
        continue;
      }
    }

    const state = normalizeOpenSkyState(raw, clock);
    if (state) {
      states.push(state);
    }
  }

  return {
    time: Math.floor(clock.now() / 1000),
    states,
  };
}

/**
 * OpenSky Network Provider Adapter
 * Implements seed-mode fixture replay and guarded live-mode fetching.
 */
export class OpenSkyAdapter {
  private readonly clock: SimClock;
  private readonly seedFixturePath: string;
  private readonly isSeedMode: boolean;
  private readonly isLiveMode: boolean;
  private readonly credentials?: { username?: string; password?: string };
  private cachedRawFixture: RawOpenSkyResponse | null = null;
  private lastRateLimitRemaining?: number;

  constructor(options: OpenSkyAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.seedFixturePath = resolveFixturePath(options.seedFixturePath);

    // Seed mode is default unless explicitly GEV_LIVE_MODE=1 and GEV_SEED_MODE!=1
    const envSeed = process.env.GEV_SEED_MODE;
    const envLive = process.env.GEV_LIVE_MODE;

    this.isLiveMode = options.liveMode ?? (envLive === '1' && envSeed !== '1');
    this.isSeedMode = options.seedMode ?? (!this.isLiveMode || envSeed === '1');
    this.credentials = options.credentials;
  }

  /**
   * Returns the remaining rate limit quota parsed from the last live response.
   */
  getRateLimitRemaining(): number | undefined {
    return this.lastRateLimitRemaining;
  }

  /**
   * Fetches or replays flight telemetry for the requested bounding box.
   */
  async getFlights(bbox?: BoundingBox): Promise<FlightBatch> {
    if (this.isSeedMode) {
      return this.loadSeedFixtures(bbox);
    }

    return this.fetchLiveFlights(bbox);
  }

  /**
   * Reads recorded seed fixture from local filesystem with zero network calls.
   */
  private async loadSeedFixtures(bbox?: BoundingBox): Promise<FlightBatch> {
    if (!this.cachedRawFixture) {
      const rawContent = await fs.promises.readFile(this.seedFixturePath, 'utf-8');
      const parsedJson = JSON.parse(rawContent);
      this.cachedRawFixture = RawOpenSkyResponseSchema.parse(parsedJson);
    }

    return parseOpenSkyPayload(this.cachedRawFixture, this.clock, bbox);
  }

  /**
   * Fetches live telemetry from OpenSky API using pinnedFetch with SSRF guards.
   */
  private async fetchLiveFlights(bbox?: BoundingBox): Promise<FlightBatch> {
    const url = new URL('https://opensky-network.org/api/states/all');

    if (bbox) {
      url.searchParams.set('lamin', bbox.min_lat.toString());
      url.searchParams.set('lamax', bbox.max_lat.toString());
      url.searchParams.set('lomin', bbox.min_lon.toString());
      url.searchParams.set('lomax', bbox.max_lon.toString());
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (this.credentials?.username && this.credentials?.password) {
      const basicAuth = Buffer.from(
        `${this.credentials.username}:${this.credentials.password}`
      ).toString('base64');
      headers.Authorization = `Basic ${basicAuth}`;
    }

    const response = await pinnedFetch(url, {
      headers,
      allowedHosts: ['opensky-network.org'],
      allowedPaths: [{ host: 'opensky-network.org', pathPrefix: '/api/states/all' }],
      timeoutMs: 15000,
      maxBytes: 10 * 1024 * 1024, // 10MB response cap
    });

    if (!response.ok) {
      throw new Error(`OpenSky API returned HTTP ${response.status}: ${response.statusText}`);
    }

    // Parse rate limit remaining header for cost governor / feed health
    const rateLimitHeader = response.headers.get('x-rate-limit-remaining');
    if (rateLimitHeader) {
      const parsedRate = Number.parseInt(rateLimitHeader, 10);
      if (!Number.isNaN(parsedRate)) {
        this.lastRateLimitRemaining = parsedRate;
      }
    }

    // Validate raw response payload at the boundary via Zod schema
    const rawJson = await response.json();
    const validated = RawOpenSkyResponseSchema.parse(rawJson);
    return parseOpenSkyPayload(validated, this.clock, bbox);
  }
}
