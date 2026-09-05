import fs from 'node:fs';
import {
  MAX_SATELLITE_RECORDS,
  type SatelliteCatalog,
  type SatelliteCatalogResponse,
  SatelliteCatalogResponseSchema,
  SatelliteCatalogSchema,
  type SatelliteOrbitalElement,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { type PinnedFetchOptions, pinnedFetch } from '@gev/security';
import { z } from 'zod';
import { resolveFixturePath } from './opensky.js';
import {
  type MarkCachedProvenanceOptions,
  createDataProvenance,
  markResponseProvenanceCached,
} from './provenance.js';

export const SATELLITE_CACHE_FRESH_SECONDS = 7_200;
export const SATELLITE_CACHE_MAX_STALE_SECONDS = 86_400;
export const SATELLITE_TRANSIENT_RETRY_SECONDS = 60;
export const CELESTRAK_GP_HOST = 'celestrak.org';
export const CELESTRAK_GP_PATH = '/NORAD/elements/gp.php';
export const SATELLITE_LIVE_GROUPS = ['STATIONS', 'WEATHER', 'GPS-OPS', 'GEO'] as const;
export type SatelliteLiveGroup = (typeof SATELLITE_LIVE_GROUPS)[number];

const SOURCE_GROUP_BY_QUERY: Record<SatelliteLiveGroup, SatelliteOrbitalElement['source_group']> = {
  STATIONS: 'stations',
  WEATHER: 'weather',
  'GPS-OPS': 'gps-ops',
  GEO: 'geo',
};

const NumericFieldSchema = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((value) => Number(value))
  .pipe(z.number().finite());
const IntegerFieldSchema = NumericFieldSchema.pipe(z.number().int());
const CelesTrakEpochSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    const explicitUtc = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
    return Number.isFinite(Date.parse(explicitUtc));
  }, 'CelesTrak epoch must be a valid UTC timestamp')
  .transform((value) => {
    const explicitUtc = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
    return new Date(explicitUtc).toISOString();
  });
const CatalogIdFieldSchema = z
  .union([
    z.number().int().nonnegative(),
    z
      .string()
      .trim()
      .regex(/^\d{1,9}$/),
  ])
  .transform(String);

export const RawCelesTrakOmmSchema = z
  .object({
    OBJECT_NAME: z.string().trim().min(1).max(160),
    OBJECT_ID: z.string().trim().max(32).nullish(),
    EPOCH: CelesTrakEpochSchema,
    MEAN_MOTION: NumericFieldSchema,
    ECCENTRICITY: NumericFieldSchema,
    INCLINATION: NumericFieldSchema,
    RA_OF_ASC_NODE: NumericFieldSchema,
    ARG_OF_PERICENTER: NumericFieldSchema,
    MEAN_ANOMALY: NumericFieldSchema,
    EPHEMERIS_TYPE: IntegerFieldSchema.pipe(z.literal(0)),
    CLASSIFICATION_TYPE: z.enum(['U', 'C']),
    NORAD_CAT_ID: CatalogIdFieldSchema,
    ELEMENT_SET_NO: IntegerFieldSchema,
    REV_AT_EPOCH: IntegerFieldSchema.nullish(),
    BSTAR: NumericFieldSchema,
    MEAN_MOTION_DOT: NumericFieldSchema,
    MEAN_MOTION_DDOT: NumericFieldSchema,
  })
  .passthrough();

const RawCelesTrakPayloadSchema = z.array(RawCelesTrakOmmSchema).max(MAX_SATELLITE_RECORDS);

export class SatelliteProviderDisabledError extends Error {
  constructor() {
    super('Satellite provider is disabled by the GEV_SATELLITES_ENABLED kill switch');
    this.name = 'SatelliteProviderDisabledError';
  }
}

export class SatelliteLiveAccessLockedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SatelliteLiveAccessLockedError';
  }
}

export class SatelliteUpstreamHttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string
  ) {
    super(`CelesTrak GP returned HTTP ${status}: ${statusText}`);
    this.name = 'SatelliteUpstreamHttpError';
  }
}

interface SatelliteFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

export type SatelliteFetcher = (
  target: URL,
  options: PinnedFetchOptions
) => Promise<SatelliteFetchResponse>;

export interface SatelliteAdapterOptions {
  clock?: SimClock;
  seedFixturePath?: string;
  seedMode?: boolean;
  liveMode?: boolean;
  enabled?: boolean;
  liveAccessEnabled?: boolean;
  termsApproved?: boolean;
  groups?: readonly SatelliteLiveGroup[];
  fetcher?: SatelliteFetcher;
  onHealthChange?: (health: 'healthy' | 'degraded' | 'unavailable') => void;
}

interface CachedSatelliteCatalog {
  response: SatelliteCatalogResponse;
  storedAtMs: number;
}

function observationPeriodForElements(elements: readonly SatelliteOrbitalElement[]) {
  const epochs = elements.map((element) => element.element_epoch).sort();
  const start = epochs[0];
  const end = epochs.at(-1);
  if (!start || !end) {
    return { status: 'unavailable' as const, reason: 'Source returned no orbital elements' };
  }
  return { status: 'available' as const, start, end };
}

function errorChainMentionsRedirect(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (current instanceof Error && current.message.toLowerCase().includes('redirect')) return true;
    if (typeof current !== 'object' || current === null || !('cause' in current)) return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function normalizeLiveElement(
  rawInput: unknown,
  group: SatelliteLiveGroup
): SatelliteOrbitalElement {
  const raw = RawCelesTrakOmmSchema.parse(rawInput);
  return {
    catalog_id: raw.NORAD_CAT_ID,
    object_name: raw.OBJECT_NAME,
    object_id: raw.OBJECT_ID || null,
    source_group: SOURCE_GROUP_BY_QUERY[group],
    element_epoch: raw.EPOCH,
    mean_motion_rev_per_day: raw.MEAN_MOTION,
    eccentricity: raw.ECCENTRICITY,
    inclination_deg: raw.INCLINATION,
    right_ascension_deg: raw.RA_OF_ASC_NODE,
    argument_of_pericenter_deg: raw.ARG_OF_PERICENTER,
    mean_anomaly_deg: raw.MEAN_ANOMALY,
    ephemeris_type: raw.EPHEMERIS_TYPE,
    classification_type: raw.CLASSIFICATION_TYPE,
    element_set_number: raw.ELEMENT_SET_NO,
    revolution_at_epoch: raw.REV_AT_EPOCH ?? null,
    bstar: raw.BSTAR,
    mean_motion_dot: raw.MEAN_MOTION_DOT,
    mean_motion_ddot: raw.MEAN_MOTION_DDOT,
    is_synthetic: false,
  };
}

/** Server-owned CelesTrak GP/OMM adapter. Callers cannot supply a URL or group. */
export class SatelliteAdapter {
  private readonly clock: SimClock;
  private readonly seedFixturePath: string;
  private readonly seedMode: boolean;
  private readonly enabled: boolean;
  private readonly liveAccessEnabled: boolean;
  private readonly termsApproved: boolean;
  private readonly groups: readonly SatelliteLiveGroup[];
  private readonly fetcher: SatelliteFetcher;
  private readonly onHealthChange: (health: 'healthy' | 'degraded' | 'unavailable') => void;
  private seedCatalog: SatelliteCatalog | null = null;
  private liveCache: CachedSatelliteCatalog | null = null;
  private refreshInFlight: Promise<SatelliteCatalogResponse> | null = null;
  private retryBlockedUntilMs: number | null = null;

  constructor(options: SatelliteAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    const liveMode =
      options.liveMode ?? (process.env.GEV_LIVE_MODE === '1' && process.env.GEV_SEED_MODE !== '1');
    this.seedMode = options.seedMode ?? !liveMode;
    this.seedFixturePath =
      options.seedFixturePath ?? resolveFixturePath('satellites-synthetic-v1.json');
    this.enabled = options.enabled ?? process.env.GEV_SATELLITES_ENABLED !== '0';
    this.liveAccessEnabled =
      options.liveAccessEnabled ?? process.env.GEV_SATELLITES_LIVE_ACCESS === '1';
    this.termsApproved = options.termsApproved ?? process.env.GEV_CELESTRAK_TERMS_APPROVED === '1';
    this.groups = this.validateGroups(options.groups ?? SATELLITE_LIVE_GROUPS);
    this.fetcher = options.fetcher ?? ((target, fetchOptions) => pinnedFetch(target, fetchOptions));
    this.onHealthChange = options.onHealthChange ?? (() => undefined);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isLiveAccessUnlocked(): boolean {
    return this.liveAccessEnabled && this.termsApproved;
  }

  async getCatalog(): Promise<SatelliteCatalogResponse> {
    this.assertEnabled();
    if (this.seedMode) {
      const response = await this.loadSeedCatalog();
      this.onHealthChange('healthy');
      return response;
    }
    this.assertLiveUnlocked();
    return this.getLiveCatalog();
  }

  private validateGroups(groups: readonly SatelliteLiveGroup[]): readonly SatelliteLiveGroup[] {
    const unique = [...new Set(groups)];
    if (unique.length === 0 || unique.some((group) => !SATELLITE_LIVE_GROUPS.includes(group))) {
      throw new Error('Satellite groups must be selected from the server allowlist');
    }
    return unique;
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new SatelliteProviderDisabledError();
  }

  private assertLiveUnlocked(): void {
    if (!this.liveAccessEnabled) {
      throw new SatelliteLiveAccessLockedError(
        'Live satellite access is locked until the platform administrator enables GEV_SATELLITES_LIVE_ACCESS'
      );
    }
    if (!this.termsApproved) {
      throw new SatelliteLiveAccessLockedError(
        'Live satellite access is locked pending written commercial-use confirmation or formal licensing-owner acceptance'
      );
    }
  }

  private async loadSeedCatalog(): Promise<SatelliteCatalogResponse> {
    if (!this.seedCatalog) {
      const raw = await fs.promises.readFile(this.seedFixturePath, 'utf8');
      this.seedCatalog = SatelliteCatalogSchema.parse(JSON.parse(raw));
    }
    return this.createResponse(this.seedCatalog, 'seed');
  }

  private async getLiveCatalog(): Promise<SatelliteCatalogResponse> {
    const now = this.clock.now();
    if (
      this.liveCache &&
      now - this.liveCache.storedAtMs <= SATELLITE_CACHE_FRESH_SECONDS * 1_000
    ) {
      return this.cachedResponse(this.liveCache);
    }
    if (this.refreshInFlight) return this.refreshInFlight;

    if (this.retryBlockedUntilMs !== null && now < this.retryBlockedUntilMs) {
      if (
        this.liveCache &&
        now - this.liveCache.storedAtMs <= SATELLITE_CACHE_MAX_STALE_SECONDS * 1_000
      ) {
        this.onHealthChange('degraded');
        return this.cachedResponse(this.liveCache);
      }
      this.onHealthChange('unavailable');
      throw new Error('CelesTrak refresh retry backoff is active after a failed attempt');
    }

    this.refreshInFlight = this.refreshLiveCatalog();
    try {
      return await this.refreshInFlight;
    } catch (error) {
      const failedAtMs = this.clock.now();
      this.retryBlockedUntilMs = failedAtMs + this.retryDelaySeconds(error) * 1_000;
      if (
        this.liveCache &&
        failedAtMs - this.liveCache.storedAtMs <= SATELLITE_CACHE_MAX_STALE_SECONDS * 1_000
      ) {
        this.onHealthChange('degraded');
        return this.cachedResponse(this.liveCache);
      }
      this.onHealthChange('unavailable');
      throw error;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async refreshLiveCatalog(): Promise<SatelliteCatalogResponse> {
    const batches = await Promise.all(this.groups.map((group) => this.fetchGroup(group)));
    const byId = new Map<string, SatelliteOrbitalElement>();
    for (const batch of batches) {
      for (const element of batch) {
        if (!byId.has(element.catalog_id)) byId.set(element.catalog_id, element);
      }
    }
    const catalog = SatelliteCatalogSchema.parse({
      schema_version: 1,
      catalog_id: `celestrak-gp-omm-${this.clock.iso().slice(0, 10)}`,
      groups: this.groups.map((group) => SOURCE_GROUP_BY_QUERY[group]),
      elements: [...byId.values()].slice(0, MAX_SATELLITE_RECORDS),
    });
    const response = this.createResponse(catalog, 'live');
    this.liveCache = { response, storedAtMs: this.clock.now() };
    this.retryBlockedUntilMs = null;
    this.onHealthChange('healthy');
    return response;
  }

  private async fetchGroup(group: SatelliteLiveGroup): Promise<SatelliteOrbitalElement[]> {
    const url = new URL(`https://${CELESTRAK_GP_HOST}${CELESTRAK_GP_PATH}`);
    url.searchParams.set('GROUP', group);
    url.searchParams.set('FORMAT', 'JSON');
    const response = await this.fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'GEV-Satellite-Adapter/2.0' },
      allowedHosts: [CELESTRAK_GP_HOST],
      allowedPaths: [{ host: CELESTRAK_GP_HOST, pathPrefix: CELESTRAK_GP_PATH }],
      timeoutMs: 15_000,
      maxBytes: 4_000_000,
    });
    if (!response.ok) {
      throw new SatelliteUpstreamHttpError(response.status, response.statusText);
    }
    const payload = RawCelesTrakPayloadSchema.parse(JSON.parse(await response.text()));
    return payload.map((item) => normalizeLiveElement(item, group));
  }

  private retryDelaySeconds(error: unknown): number {
    if (errorChainMentionsRedirect(error)) return SATELLITE_CACHE_FRESH_SECONDS;
    if (
      error instanceof SatelliteUpstreamHttpError &&
      (error.status === 301 || error.status === 500 || (error.status >= 400 && error.status < 500))
    ) {
      return SATELLITE_CACHE_FRESH_SECONDS;
    }
    return SATELLITE_TRANSIENT_RETRY_SECONDS;
  }

  private createResponse(
    catalog: SatelliteCatalog,
    sourceMode: 'seed' | 'live'
  ): SatelliteCatalogResponse {
    return SatelliteCatalogResponseSchema.parse({
      ...catalog,
      provenance: createDataProvenance({
        providerId: 'celestrak',
        feedId: 'satellites',
        clock: this.clock,
        sourceMode,
        observationPeriod: observationPeriodForElements(catalog.elements),
        vintage: {
          status: 'available',
          value: sourceMode === 'seed' ? 'synthetic-fixture-2026-09-04' : catalog.catalog_id,
        },
        ...(sourceMode === 'seed' ? { fixtureId: 'satellites-synthetic-v1' } : {}),
      }),
    });
  }

  private cachedResponse(cache: CachedSatelliteCatalog): SatelliteCatalogResponse {
    const options: MarkCachedProvenanceOptions = {
      clock: this.clock,
      cacheId: 'celestrak-gp-omm-shared-v1',
      storedAtMs: cache.storedAtMs,
    };
    return SatelliteCatalogResponseSchema.parse(
      markResponseProvenanceCached(cache.response, options)
    );
  }
}
