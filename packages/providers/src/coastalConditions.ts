import fs from 'node:fs';
import {
  COOPS_MAX_RECORDS,
  COOPS_MAX_STATIONS,
  COOPS_USAGE_NOTICE,
  type CoastalConditionsResponse,
  CoastalConditionsResponseSchema,
  type CoastalCurrentObservation,
  type CoastalCurrentPrediction,
  type CoastalStation,
  type CoastalTidePrediction,
  type CoastalValue,
  type CoastalWaterLevelObservation,
  type OperationalAoi,
  OperationalAoiSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  CoastalSeedFixtureSchema,
  type RawProductResponse,
  RawProductResponseSchema,
  RawStationCollectionSchema,
  type SourceStation,
} from './coastalPayloads.js';
import {
  type CoopsInstant,
  coopsDate,
  coopsInstant,
  nullableNumber,
  numericValue,
  strings,
} from './coastalValues.js';
import { resolveFixturePath } from './opensky.js';
import {
  type OperationalFetcher,
  defaultOperationalFetcher,
  normalizedAoiKey,
  pointInAoi,
  readBoundedJson,
} from './operationalHttp.js';
import { createDataProvenance, unavailableObservationPeriod } from './provenance.js';
import { OperationalSourceError } from './solarContext.js';

const COOPS_HOST = 'api.tidesandcurrents.noaa.gov';
const DATA_ROOT = `https://${COOPS_HOST}/api/prod/datagetter`;
const METADATA_ROOT = `https://${COOPS_HOST}/mdapi/prod/webapi`;
const COOPS_MAX_BYTES = 2_097_152;
const COOPS_MAX_STALE_MS = 1_800_000;
const COOPS_MAX_UPSTREAM_REQUESTS_PER_HOUR = 240;
const STATION_COLLECTION_TYPES = [
  'waterlevels',
  'tidepredictions',
  'currents',
  'currentpredictions',
] as const;
type StationCollectionType = (typeof STATION_COLLECTION_TYPES)[number];
type StationType = CoastalStation['station_types'][number];
type Product = 'water_level' | 'predictions' | 'currents' | 'currents_predictions';

export interface CoastalConditionsAdapterOptions {
  clock?: SimClock;
  seedMode?: boolean;
  enabled?: boolean;
  liveAccessEnabled?: boolean;
  termsApproved?: boolean;
  applicationId?: string;
  seedFixturePath?: string;
  fetcher?: OperationalFetcher;
}

function stationType(collectionType: StationCollectionType): StationType {
  return {
    waterlevels: 'water_level',
    tidepredictions: 'tide_prediction',
    currents: 'current',
    currentpredictions: 'current_prediction',
  }[collectionType] as StationType;
}

function productFor(type: StationType): Product {
  return {
    water_level: 'water_level',
    tide_prediction: 'predictions',
    current: 'currents',
    current_prediction: 'currents_predictions',
  }[type] as Product;
}

function normalizeWaterObservations(
  response: RawProductResponse | undefined,
  now: number,
  timeCache: Map<string, CoopsInstant>,
  valueCache: Map<string, CoastalValue>,
  stringCache: Map<string, string[]>
): CoastalWaterLevelObservation[] {
  const normalized: CoastalWaterLevelObservation[] = [];
  for (const record of response?.data ?? []) {
    const observedAt = coopsInstant(record.t, 'CO-OPS water-level observation time', timeCache);
    const age = now - observedAt.milliseconds;
    if (age < -300_000 || age > COOPS_MAX_STALE_MS) continue;
    const quality = String(record.q ?? '').toLowerCase();
    normalized.push({
      observed_at: observedAt.iso,
      value: numericValue(record.v, 'Water level', valueCache),
      sigma: nullableNumber(record.s),
      quality: quality === 'p' ? 'preliminary' : quality === 'v' ? 'verified' : 'unknown',
      flags: strings(record.f, stringCache),
    });
  }
  return normalized;
}

function normalizeTidePredictions(
  response: RawProductResponse | undefined,
  now: number,
  timeCache: Map<string, CoopsInstant>,
  valueCache: Map<string, CoastalValue>
): CoastalTidePrediction[] {
  return (response?.predictions ?? []).flatMap((record) => {
    const validAt = coopsInstant(record.t, 'CO-OPS tide prediction time', timeCache);
    if (validAt.milliseconds < now) return [];
    const tideType = ['HH', 'H', 'L', 'LL'].includes(String(record.type ?? record.ty))
      ? (String(record.type ?? record.ty) as CoastalTidePrediction['tide_type'])
      : null;
    return [
      {
        valid_at: validAt.iso,
        value: numericValue(record.v, 'Predicted water level', valueCache),
        tide_type: tideType,
      },
    ];
  });
}

function normalizeCurrentObservations(
  response: RawProductResponse | undefined,
  now: number,
  timeCache: Map<string, CoopsInstant>,
  valueCache: Map<string, CoastalValue>,
  stringCache: Map<string, string[]>
): CoastalCurrentObservation[] {
  return (response?.data ?? []).flatMap((record) => {
    const observedAt = coopsInstant(record.t, 'CO-OPS current observation time', timeCache);
    const age = now - observedAt.milliseconds;
    if (age < -300_000 || age > COOPS_MAX_STALE_MS) return [];
    const bin = Number(record.b);
    return [
      {
        observed_at: observedAt.iso,
        speed: numericValue(record.s, 'Current speed', valueCache),
        direction_deg: numericValue(record.d, 'Current direction', valueCache),
        bin: Number.isInteger(bin) && bin >= 0 ? bin : null,
        quality_flags: strings(record.f ?? record.q, stringCache),
      },
    ];
  });
}

function currentPredictionRecords(response: RawProductResponse | undefined) {
  const value = response?.current_predictions;
  return Array.isArray(value) ? value : (value?.cp ?? response?.predictions ?? []);
}

function normalizeCurrentPredictions(
  response: RawProductResponse | undefined,
  now: number,
  timeCache: Map<string, CoopsInstant>,
  valueCache: Map<string, CoastalValue>
): CoastalCurrentPrediction[] {
  return currentPredictionRecords(response).flatMap((record) => {
    const validAt = coopsInstant(
      record.Time ?? record.t,
      'CO-OPS current prediction time',
      timeCache
    );
    if (validAt.milliseconds < now) return [];
    const bin = Number(record.Bin ?? record.b);
    return [
      {
        valid_at: validAt.iso,
        speed: numericValue(record.Speed ?? record.s, 'Predicted current speed', valueCache),
        direction_deg: numericValue(
          record.Direction ?? record.d,
          'Predicted current direction',
          valueCache
        ),
        velocity_major: numericValue(
          record.Velocity_Major,
          'Predicted major-axis velocity',
          valueCache
        ),
        mean_ebb_direction_deg: numericValue(record.meanEbbDir, 'Mean ebb direction', valueCache),
        mean_flood_direction_deg: numericValue(
          record.meanFloodDir,
          'Mean flood direction',
          valueCache
        ),
        bin: Number.isInteger(bin) && bin >= 0 ? bin : null,
        depth: numericValue(record.Depth, 'Current-bin depth', valueCache),
      },
    ];
  });
}

function latestObservation(
  stations: CoastalStation[],
  key: 'water_level_observations' | 'current_observations'
) {
  let start: string | null = null;
  let end: string | null = null;
  for (const station of stations) {
    for (const item of station[key]) {
      if (start === null || item.observed_at < start) start = item.observed_at;
      if (end === null || item.observed_at > end) end = item.observed_at;
    }
  }
  return start !== null && end !== null
    ? { status: 'available' as const, start, end }
    : unavailableObservationPeriod(`No current CO-OPS ${key.replaceAll('_', ' ')} in the AOI`);
}

export function parseCoastalConditions(
  sourceStations: readonly SourceStation[],
  aoi: OperationalAoi,
  clock: SimClock,
  sourceMode: 'seed' | 'live'
): CoastalConditionsResponse {
  const now = clock.now();
  const timeCache = new Map<string, CoopsInstant>();
  const valueCache = new Map<string, CoastalValue>();
  const stringCache = new Map<string, string[]>();
  const stations = sourceStations
    .filter(({ metadata }) => pointInAoi(Number(metadata.lng), Number(metadata.lat), aoi))
    .slice(0, COOPS_MAX_STATIONS)
    .map(
      ({ metadata, station_types, datum, units, time_zone, products }): CoastalStation => ({
        station_id: String(metadata.id),
        name: metadata.name,
        position: { longitude: Number(metadata.lng), latitude: Number(metadata.lat) },
        station_types,
        datum,
        units,
        time_zone,
        station_time_zone_name: metadata.timezone ?? null,
        metadata_retrieved_at: clock.iso(),
        water_level_observations: normalizeWaterObservations(
          products.water_level,
          now,
          timeCache,
          valueCache,
          stringCache
        ),
        tide_predictions: normalizeTidePredictions(
          products.predictions,
          now,
          timeCache,
          valueCache
        ),
        current_observations: normalizeCurrentObservations(
          products.currents,
          now,
          timeCache,
          valueCache,
          stringCache
        ),
        current_predictions: normalizeCurrentPredictions(
          products.currents_predictions,
          now,
          timeCache,
          valueCache
        ),
      })
    )
    .filter(
      (station) =>
        station.water_level_observations.length +
          station.tide_predictions.length +
          station.current_observations.length +
          station.current_predictions.length >
        0
    );
  const recordCount = stations.reduce(
    (count, station) =>
      count +
      station.water_level_observations.length +
      station.tide_predictions.length +
      station.current_observations.length +
      station.current_predictions.length,
    0
  );
  if (recordCount > COOPS_MAX_RECORDS)
    throw new Error('CO-OPS response exceeds the record ceiling');
  const provenanceOptions = {
    providerId: 'noaa-coops',
    clock,
    sourceMode,
    ...(sourceMode === 'seed' ? { fixtureId: 'coops-coastal-synthetic-v1' } : {}),
  };
  const waterLevelProvenance = createDataProvenance({
    ...provenanceOptions,
    feedId: 'coastal-water-levels',
    observationPeriod: latestObservation(stations, 'water_level_observations'),
  });
  const currentProvenance = createDataProvenance({
    ...provenanceOptions,
    feedId: 'coastal-currents',
    observationPeriod: latestObservation(stations, 'current_observations'),
  });
  return CoastalConditionsResponseSchema.parse({
    retrieved_at: clock.iso(),
    count: stations.length,
    record_count: recordCount,
    stations,
    usage_notice: COOPS_USAGE_NOTICE,
    water_level_provenance: waterLevelProvenance,
    current_provenance: currentProvenance,
    provenance: waterLevelProvenance,
  });
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        const item = items[index];
        if (item !== undefined) results[index] = await task(item);
      }
    })
  );
  return results;
}

export class CoastalConditionsAdapter {
  private readonly clock: SimClock;
  private readonly seedMode: boolean;
  private readonly enabled: boolean;
  private readonly liveAccessEnabled: boolean;
  private readonly termsApproved: boolean;
  private readonly applicationId?: string;
  private readonly seedFixturePath: string;
  private readonly fetcher: OperationalFetcher;
  private requestTimes: number[] = [];
  private readonly inFlight = new Map<string, Promise<CoastalConditionsResponse>>();

  constructor(options: CoastalConditionsAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    const envLive = process.env.GEV_LIVE_MODE === '1' && process.env.GEV_SEED_MODE !== '1';
    this.seedMode = options.seedMode ?? !envLive;
    this.enabled = options.enabled ?? process.env.GEV_COOPS_ENABLED !== '0';
    this.liveAccessEnabled = options.liveAccessEnabled ?? process.env.GEV_COOPS_LIVE_ACCESS === '1';
    this.termsApproved = options.termsApproved ?? process.env.GEV_COOPS_TERMS_APPROVED === '1';
    this.applicationId = options.applicationId ?? process.env.GEV_COOPS_APPLICATION_ID;
    this.seedFixturePath =
      options.seedFixturePath ?? resolveFixturePath('coops-coastal-synthetic-v1.json');
    this.fetcher = options.fetcher ?? defaultOperationalFetcher;
  }

  async getConditions(input: OperationalAoi): Promise<CoastalConditionsResponse> {
    if (!this.enabled)
      throw new OperationalSourceError('PROVIDER_DISABLED', 'NOAA CO-OPS is disabled by policy');
    const aoi = OperationalAoiSchema.parse(input);
    const key = normalizedAoiKey(aoi);
    const active = this.inFlight.get(key);
    if (active) return active;
    const pending = this.load(aoi).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  private async load(aoi: OperationalAoi): Promise<CoastalConditionsResponse> {
    try {
      const stations = this.seedMode ? await this.readSeed() : await this.readLive(aoi);
      return parseCoastalConditions(stations, aoi, this.clock, this.seedMode ? 'seed' : 'live');
    } catch (error) {
      if (error instanceof OperationalSourceError) throw error;
      throw new OperationalSourceError(
        'UPSTREAM_CONTRACT_ERROR',
        'CO-OPS response failed bounded validation',
        502
      );
    }
  }

  private async readSeed(): Promise<SourceStation[]> {
    const fixture = CoastalSeedFixtureSchema.parse(
      JSON.parse(await fs.promises.readFile(this.seedFixturePath, 'utf8'))
    );
    return fixture.stations;
  }

  private consumeRequestBudget(): void {
    const now = this.clock.now();
    this.requestTimes = this.requestTimes.filter((time) => now - time < 3_600_000);
    if (this.requestTimes.length >= COOPS_MAX_UPSTREAM_REQUESTS_PER_HOUR) {
      throw new OperationalSourceError(
        'RATE_LIMITED',
        'CO-OPS upstream request budget is exhausted',
        429
      );
    }
    this.requestTimes.push(now);
  }

  private async fetchJson(url: string, pathPrefix: string): Promise<unknown> {
    this.consumeRequestBudget();
    return readBoundedJson(
      await this.fetcher(url, {
        timeoutMs: 10_000,
        maxBytes: COOPS_MAX_BYTES,
        allowedHosts: [COOPS_HOST],
        allowedPaths: [{ host: COOPS_HOST, pathPrefix }],
        headers: { Accept: 'application/json' },
      }),
      COOPS_MAX_BYTES
    );
  }

  private async readLive(aoi: OperationalAoi): Promise<SourceStation[]> {
    if (!this.liveAccessEnabled || !this.termsApproved) {
      throw new OperationalSourceError(
        'TERMS_APPROVAL_REQUIRED',
        'Live CO-OPS data requires recorded terms approval and explicit live access',
        423
      );
    }
    const applicationId = this.applicationId?.trim() ?? '';
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(applicationId)) {
      throw new OperationalSourceError(
        'CONFIGURATION_REQUIRED',
        'A fixed CO-OPS application identifier is required',
        423
      );
    }
    const collections = await mapConcurrent(STATION_COLLECTION_TYPES, 4, async (type) => {
      const url = `${METADATA_ROOT}/stations.json?type=${type}&units=metric`;
      const payload = RawStationCollectionSchema.parse(
        await this.fetchJson(url, '/mdapi/prod/webapi/stations.json')
      );
      return { type, stations: payload.stationList ?? payload.stations ?? [] };
    });
    const byId = new Map<string, SourceStation>();
    for (const collection of collections) {
      for (const metadata of collection.stations) {
        if (!pointInAoi(Number(metadata.lng), Number(metadata.lat), aoi)) continue;
        const id = String(metadata.id);
        const existing = byId.get(id) ?? {
          metadata,
          station_types: [],
          datum: null,
          units: 'metric' as const,
          time_zone: 'gmt' as const,
          products: {},
        };
        const type = stationType(collection.type);
        if (!existing.station_types.includes(type)) existing.station_types.push(type);
        if (type === 'water_level' || type === 'tide_prediction') existing.datum = 'MLLW';
        byId.set(id, existing);
        if (byId.size >= COOPS_MAX_STATIONS) break;
      }
    }
    const stations = [...byId.values()].slice(0, COOPS_MAX_STATIONS);
    const tasks = stations
      .flatMap((station) =>
        station.station_types.map((type) => ({ station, product: productFor(type) }))
      )
      .slice(0, COOPS_MAX_UPSTREAM_REQUESTS_PER_HOUR - STATION_COLLECTION_TYPES.length);
    await mapConcurrent(tasks, 4, async ({ station, product }) => {
      const now = this.clock.now();
      const prediction = product === 'predictions' || product === 'currents_predictions';
      const params = new URLSearchParams({
        begin_date: coopsDate(prediction ? now : now - COOPS_MAX_STALE_MS),
        end_date: coopsDate(prediction ? now + 86_400_000 : now),
        station: String(station.metadata.id),
        product,
        time_zone: 'gmt',
        units: 'metric',
        application: applicationId,
        format: 'json',
      });
      if (product === 'water_level' || product === 'predictions') params.set('datum', 'MLLW');
      if (product === 'predictions') params.set('interval', 'hilo');
      if (product === 'currents_predictions') {
        params.set('interval', '10');
        params.set('vel_type', 'speed_dir');
      }
      station.products[product] = RawProductResponseSchema.parse(
        await this.fetchJson(`${DATA_ROOT}?${params.toString()}`, '/api/prod/datagetter')
      );
    });
    return stations;
  }
}
