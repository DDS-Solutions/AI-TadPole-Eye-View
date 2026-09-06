import fs from 'node:fs';
import {
  AWC_PRODUCT_MAX_RECORDS,
  type AviationMetar,
  type AviationSigmet,
  type AviationTaf,
  type AviationWeatherResponse,
  AviationWeatherResponseSchema,
  type OperationalAoi,
  OperationalAoiSchema,
  OperationalAreaGeometrySchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { z } from 'zod';
import { resolveFixturePath } from './opensky.js';
import {
  type OperationalFetcher,
  assertIdentifiedUserAgent,
  defaultOperationalFetcher,
  geometryIntersectsAoi,
  normalizeIsoTime,
  pointInAoi,
  readBoundedJson,
} from './operationalHttp.js';
import {
  createDataProvenance,
  observationPeriodFromIso,
  observationPeriodFromUnixRange,
} from './provenance.js';
import { OperationalSourceError } from './solarContext.js';

const AWC_MAX_BYTES = 4_194_304;
const AWC_ENDPOINT_ROOT = 'https://aviationweather.gov/api/data';
const PointGeometrySchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
  ]),
});
const RawFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z
    .array(
      z.object({
        type: z.literal('Feature'),
        id: z.union([z.string(), z.number()]).optional(),
        geometry: z.union([PointGeometrySchema, OperationalAreaGeometrySchema]).nullable(),
        properties: z.record(z.unknown()),
      })
    )
    .max(AWC_PRODUCT_MAX_RECORDS),
});

type AwcProduct = 'metar' | 'taf' | 'airsigmet';

export interface AviationWeatherAdapterOptions {
  clock?: SimClock;
  seedMode?: boolean;
  enabled?: boolean;
  liveAccessEnabled?: boolean;
  termsApproved?: boolean;
  userAgent?: string;
  metarFixturePath?: string;
  tafFixturePath?: string;
  sigmetFixturePath?: string;
  fetcher?: OperationalFetcher;
}

function requiredString(
  properties: Record<string, unknown>,
  keys: string[],
  field: string
): string {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  throw new Error(`AWC feature is missing ${field}`);
}

function optionalNumber(properties: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function observationPeriod(times: string[]) {
  if (times.length === 0) return observationPeriodFromIso('invalid');
  const epochSeconds = times.map((value) => Math.floor(Date.parse(value) / 1000));
  return observationPeriodFromUnixRange(Math.min(...epochSeconds), Math.max(...epochSeconds));
}

function normalizeMetars(payload: unknown, aoi: OperationalAoi, now: number): AviationMetar[] {
  const raw = RawFeatureCollectionSchema.parse(payload);
  const metars: AviationMetar[] = [];
  for (const feature of raw.features) {
    if (feature.geometry?.type !== 'Point') continue;
    const [longitude, latitude] = feature.geometry.coordinates;
    if (!pointInAoi(longitude, latitude, aoi)) continue;
    const stationId = requiredString(feature.properties, ['icaoId', 'station_id'], 'station ID');
    const observationTime = normalizeIsoTime(
      feature.properties.reportTime ?? feature.properties.obsTime,
      'METAR observation time'
    );
    if (
      Date.parse(observationTime) > now + 300_000 ||
      now - Date.parse(observationTime) > 7_200_000
    ) {
      continue;
    }
    const category = String(feature.properties.fltCat ?? 'UNKNOWN').toUpperCase();
    metars.push({
      id: `metar-${stationId}-${observationTime}`,
      station_id: stationId,
      position: { longitude, latitude },
      observation_time: observationTime,
      raw_text: requiredString(feature.properties, ['rawOb', 'raw_text'], 'raw METAR'),
      flight_category: ['VFR', 'MVFR', 'IFR', 'LIFR'].includes(category)
        ? (category as AviationMetar['flight_category'])
        : 'UNKNOWN',
      temperature_c: optionalNumber(feature.properties, ['temp', 'temp_c']),
      wind_speed_kt: optionalNumber(feature.properties, ['wspd', 'wind_speed_kt']),
    });
  }
  return metars;
}

function normalizeTafs(payload: unknown, aoi: OperationalAoi, now: number): AviationTaf[] {
  const raw = RawFeatureCollectionSchema.parse(payload);
  const tafs: AviationTaf[] = [];
  for (const feature of raw.features) {
    if (feature.geometry?.type !== 'Point') continue;
    const [longitude, latitude] = feature.geometry.coordinates;
    if (!pointInAoi(longitude, latitude, aoi)) continue;
    const stationId = requiredString(feature.properties, ['icaoId', 'station_id'], 'station ID');
    const issueTime = normalizeIsoTime(feature.properties.issueTime, 'TAF issue time');
    const validFrom = normalizeIsoTime(feature.properties.validTimeFrom, 'TAF valid-from time');
    const validTo = normalizeIsoTime(feature.properties.validTimeTo, 'TAF valid-to time');
    if (Date.parse(validTo) <= now) continue;
    tafs.push({
      id: `taf-${stationId}-${issueTime}`,
      station_id: stationId,
      position: { longitude, latitude },
      issue_time: issueTime,
      valid_from: validFrom,
      valid_to: validTo,
      raw_text: requiredString(feature.properties, ['rawTAF', 'raw_text'], 'raw TAF'),
    });
  }
  return tafs;
}

function normalizeSigmets(payload: unknown, aoi: OperationalAoi, now: number): AviationSigmet[] {
  const raw = RawFeatureCollectionSchema.parse(payload);
  const sigmets: AviationSigmet[] = [];
  for (const feature of raw.features) {
    if (!feature.geometry || feature.geometry.type === 'Point') continue;
    if (!geometryIntersectsAoi(feature.geometry, aoi)) continue;
    const issueTime = normalizeIsoTime(feature.properties.issueTime, 'SIGMET issue time');
    const validFrom = normalizeIsoTime(feature.properties.validTimeFrom, 'SIGMET valid-from time');
    const validTo = normalizeIsoTime(feature.properties.validTimeTo, 'SIGMET valid-to time');
    if (Date.parse(validFrom) > now || Date.parse(validTo) <= now) continue;
    sigmets.push({
      id: String(feature.properties.id ?? feature.id ?? `sigmet-${sigmets.length}`),
      hazard: requiredString(feature.properties, ['hazard', 'hazardType'], 'SIGMET hazard'),
      issue_time: issueTime,
      valid_from: validFrom,
      valid_to: validTo,
      raw_text: requiredString(
        feature.properties,
        ['rawSigmet', 'rawAirSigmet', 'raw_text'],
        'raw SIGMET'
      ),
      geometry: feature.geometry,
    });
  }
  return sigmets;
}

export function parseAviationWeather(
  payloads: { metar: unknown; taf: unknown; airsigmet: unknown },
  aoi: OperationalAoi,
  clock: SimClock,
  sourceMode: 'seed' | 'live'
): AviationWeatherResponse {
  const now = clock.now();
  const metars = normalizeMetars(payloads.metar, aoi, now);
  const tafs = normalizeTafs(payloads.taf, aoi, now);
  const sigmets = normalizeSigmets(payloads.airsigmet, aoi, now);
  const provenanceFor = (
    feedId: 'aviation-metar' | 'aviation-taf' | 'aviation-sigmet',
    times: string[]
  ) =>
    createDataProvenance({
      providerId: 'noaa-aviation-weather-center',
      feedId,
      clock,
      sourceMode,
      observationPeriod: observationPeriod(times),
      ...(sourceMode === 'seed'
        ? { fixtureId: `awc-${feedId.replace('aviation-', '')}-synthetic-v1` }
        : {}),
    });
  const metarProvenance = provenanceFor(
    'aviation-metar',
    metars.map((item) => item.observation_time)
  );
  const tafProvenance = provenanceFor(
    'aviation-taf',
    tafs.map((item) => item.issue_time)
  );
  const sigmetProvenance = provenanceFor(
    'aviation-sigmet',
    sigmets.map((item) => item.issue_time)
  );
  return AviationWeatherResponseSchema.parse({
    retrieved_at: clock.iso(),
    metars: { count: metars.length, items: metars, provenance: metarProvenance },
    tafs: { count: tafs.length, items: tafs, provenance: tafProvenance },
    sigmets: { count: sigmets.length, items: sigmets, provenance: sigmetProvenance },
    provenance: metarProvenance,
  });
}

export class AviationWeatherAdapter {
  private readonly clock: SimClock;
  private readonly seedMode: boolean;
  private readonly enabled: boolean;
  private readonly liveAccessEnabled: boolean;
  private readonly termsApproved: boolean;
  private readonly userAgent?: string;
  private readonly fixturePaths: Record<AwcProduct, string>;
  private readonly fetcher: OperationalFetcher;

  constructor(options: AviationWeatherAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    const envLive = process.env.GEV_LIVE_MODE === '1' && process.env.GEV_SEED_MODE !== '1';
    this.seedMode = options.seedMode ?? !envLive;
    this.enabled = options.enabled ?? process.env.GEV_AWC_WEATHER_ENABLED !== '0';
    this.liveAccessEnabled =
      options.liveAccessEnabled ?? process.env.GEV_AWC_WEATHER_LIVE_ACCESS === '1';
    this.termsApproved = options.termsApproved ?? process.env.GEV_AWC_TERMS_APPROVED === '1';
    this.userAgent = options.userAgent ?? process.env.GEV_AWC_USER_AGENT;
    this.fixturePaths = {
      metar: options.metarFixturePath ?? resolveFixturePath('awc-metar-synthetic-v1.geojson'),
      taf: options.tafFixturePath ?? resolveFixturePath('awc-taf-synthetic-v1.geojson'),
      airsigmet: options.sigmetFixturePath ?? resolveFixturePath('awc-sigmet-synthetic-v1.geojson'),
    };
    this.fetcher = options.fetcher ?? defaultOperationalFetcher;
  }

  async getWeather(input: OperationalAoi): Promise<AviationWeatherResponse> {
    if (!this.enabled)
      throw new OperationalSourceError('PROVIDER_DISABLED', 'AWC weather is disabled by policy');
    const aoi = OperationalAoiSchema.parse(input);
    try {
      const firstPair = await Promise.all([
        this.readProduct('metar', aoi),
        this.readProduct('taf', aoi),
      ]);
      const airsigmet = await this.readProduct('airsigmet', aoi);
      return parseAviationWeather(
        { metar: firstPair[0], taf: firstPair[1], airsigmet },
        aoi,
        this.clock,
        this.seedMode ? 'seed' : 'live'
      );
    } catch (error) {
      if (error instanceof OperationalSourceError) throw error;
      throw new OperationalSourceError(
        'UPSTREAM_CONTRACT_ERROR',
        'AWC response failed contract validation',
        502
      );
    }
  }

  private async readProduct(product: AwcProduct, aoi: OperationalAoi): Promise<unknown> {
    if (this.seedMode) {
      return JSON.parse(await fs.promises.readFile(this.fixturePaths[product], 'utf8')) as unknown;
    }
    if (!this.liveAccessEnabled || !this.termsApproved) {
      throw new OperationalSourceError(
        'TERMS_APPROVAL_REQUIRED',
        'Live AWC weather requires recorded source approval and explicit live access',
        423
      );
    }
    const userAgent = assertIdentifiedUserAgent(this.userAgent, false);
    const bbox = [aoi.min_lat, aoi.min_lon, aoi.max_lat, aoi.max_lon].join(',');
    const url = `${AWC_ENDPOINT_ROOT}/${product}?format=geojson&bbox=${encodeURIComponent(bbox)}`;
    const response = await this.fetcher(url, {
      timeoutMs: 10_000,
      maxBytes: AWC_MAX_BYTES,
      allowedHosts: ['aviationweather.gov'],
      allowedPaths: [{ host: 'aviationweather.gov', pathPrefix: `/api/data/${product}` }],
      headers: { Accept: 'application/geo+json', 'User-Agent': userAgent },
    });
    return readBoundedJson(response, AWC_MAX_BYTES);
  }
}
