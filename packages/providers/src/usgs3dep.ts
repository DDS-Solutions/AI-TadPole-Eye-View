import fs from 'node:fs';
import {
  type DataProvenance,
  type EconomicEstimate,
  USGS_3DEP_ADVISORY_DISCLAIMER,
  USGS_3DEP_DEFAULT_VINTAGE,
  USGS_3DEP_MODERN_EPQS_URL,
  Usgs3DepBatchQuerySchema,
  type Usgs3DepElevationPointResult,
  Usgs3DepElevationPointResultSchema,
  type Usgs3DepFixtureDataset,
  Usgs3DepFixtureDatasetSchema,
  type Usgs3DepPointFixture,
  type Usgs3DepPointQuery,
  Usgs3DepPointQuerySchema,
  type Usgs3DepSlopeResult,
  Usgs3DepSlopeResultSchema,
  RawUsgsEpqsResponseSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  calculateTerrainSlope,
  parseUsgsRawElevation,
  validateEpqsEndpoint,
  validateUsgsCoordinates,
} from '@gev/economic';
import { type PinnedFetchOptions, pinnedFetch } from '@gev/security';
import { resolveFixturePath } from './opensky.js';

function createUsgs3DepProvenance(clock: SimClock, mode: 'seed' | 'live'): DataProvenance {
  const nowIso = new Date(clock.now()).toISOString();
  return {
    schema_version: 1,
    source: {
      provider_id: USGS_3DEP_PROVIDER_ID,
      feed_id: USGS_3DEP_FEED_ID,
      name: 'USGS Elevation Point Query Service (EPQS)',
      canonical_url: USGS_3DEP_MODERN_EPQS_URL,
    },
    retrieved_at: nowIso,
    observation_period: {
      status: 'available',
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-09-27T23:59:59.000Z',
    },
    vintage: {
      status: 'available',
      value: USGS_3DEP_DEFAULT_VINTAGE,
    },
    mode,
    source_mode: mode,
    license: {
      id: 'us-government-public-domain',
      name: 'U.S. Government Work - 17 U.S.C. 105 (Public Domain)',
    },
    attribution: 'U.S. Geological Survey, 3D Elevation Program (3DEP)',
    fixture_id: mode === 'seed' ? USGS_3DEP_SEED_FIXTURE_ID : null,
    cache: null,
    freshness: {
      status: 'fresh',
      age_seconds: 0,
      fresh_for_seconds: 2592000,
    },
  };
}

export const USGS_3DEP_PROVIDER_ID = 'usgs-3dep' as const;
export const USGS_3DEP_FEED_ID = 'elevation-epqs' as const;
export const USGS_3DEP_SEED_FIXTURE_ID = 'usgs-3dep-synthetic-v1' as const;

export class Usgs3DepDisabledError extends Error {
  constructor() {
    super('USGS 3DEP provider is disabled by the GEV_USGS_3DEP_ENABLED kill switch');
    this.name = 'Usgs3DepDisabledError';
  }
}

export class Usgs3DepSeedModeViolationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Live USGS 3DEP API requests require explicit developer authorization and are prohibited in seed mode (PLAN.md §2 Principle 4 & §10 Task 11.2)'
    );
    this.name = 'Usgs3DepSeedModeViolationError';
  }
}

export class Usgs3DepRetiredEndpointError extends Error {
  constructor(endpointUrl: string) {
    super(
      `USGS 3DEP retired pqs.php endpoint is prohibited (${endpointUrl}). Use modern EPQS REST endpoint https://epqs.nationalmap.gov/v1/json (PLAN.md §10 Task 11.2)`
    );
    this.name = 'Usgs3DepRetiredEndpointError';
  }
}

export class Usgs3DepInvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Usgs3DepInvalidQueryError';
  }
}

export interface Usgs3DepAdapterOptions {
  clock?: SimClock;
  fixturePath?: string;
  enabled?: boolean;
  seedMode?: boolean;
  allowLiveCalls?: boolean;
  endpointUrl?: string;
  pinnedFetchOptions?: Partial<PinnedFetchOptions>;
}

/**
 * USGS 3DEP Elevation Point Query Service (EPQS) Provider Adapter.
 * Implements PLAN.md §10 Task 11.2 and ADR 0063.
 * Adheres strictly to:
 * - Modern EPQS REST endpoint only (https://epqs.nationalmap.gov/v1/json); retired pqs.php is banned.
 * - Non-coercion of off-coverage sentinel (-1000000) or null to 0.0 sea level.
 * - Valid negative land elevations (e.g. Badwater Basin at -86m) preserved as available.
 * - Zero live network calls without explicit developer authorization under GEV_SEED_MODE=1.
 * - Kill switch GEV_USGS_3DEP_ENABLED fails closed.
 */
export class Usgs3DepAdapter {
  readonly clock: SimClock;
  private readonly fixturePath: string;
  private readonly enabled: boolean;
  private readonly seedMode: boolean;
  private readonly allowLiveCalls: boolean;
  private readonly endpointUrl: string;
  private readonly pinnedFetchOptions: Partial<PinnedFetchOptions>;
  private cachedFixture: Usgs3DepFixtureDataset | null = null;
  private cachedPoints: readonly Usgs3DepPointFixture[] | null = null;

  constructor(options: Usgs3DepAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.fixturePath = options.fixturePath ?? resolveFixturePath('usgs-3dep-synthetic-v1.json');
    this.enabled = options.enabled ?? process.env.GEV_USGS_3DEP_ENABLED !== '0';
    this.seedMode = options.seedMode ?? process.env.GEV_SEED_MODE !== '0';
    this.allowLiveCalls = options.allowLiveCalls ?? false;
    this.endpointUrl = options.endpointUrl ?? USGS_3DEP_MODERN_EPQS_URL;
    this.pinnedFetchOptions = options.pinnedFetchOptions ?? {};

    // Check endpoint URL against retired endpoint
    if (this.endpointUrl.includes('pqs.php')) {
      throw new Usgs3DepRetiredEndpointError(this.endpointUrl);
    }
    validateEpqsEndpoint(this.endpointUrl);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isSeedMode(): boolean {
    return this.seedMode;
  }

  getEndpointUrl(): string {
    return this.endpointUrl;
  }

  getAdvisoryDisclaimer(): string {
    return USGS_3DEP_ADVISORY_DISCLAIMER;
  }

  loadFixture(): Usgs3DepFixtureDataset {
    if (this.cachedFixture) {
      return this.cachedFixture;
    }

    if (!fs.existsSync(this.fixturePath)) {
      throw new Error(`USGS 3DEP seed fixture not found at '${this.fixturePath}'`);
    }

    const stat = fs.statSync(this.fixturePath);
    if (stat.size > 20_000_000) {
      throw new Error(`USGS 3DEP fixture file exceeds 20MB limit: ${stat.size} bytes`);
    }

    const raw = fs.readFileSync(this.fixturePath, 'utf8');
    const parsed = JSON.parse(raw);
    const validated = Usgs3DepFixtureDatasetSchema.parse(parsed);

    this.cachedFixture = validated;
    this.cachedPoints = validated.points;
    return validated;
  }

  loadPoints(): readonly Usgs3DepPointFixture[] {
    if (this.cachedPoints) {
      return this.cachedPoints;
    }
    return this.loadFixture().points;
  }

  /**
   * Retrieves elevation for a single coordinate point.
   */
  async getElevation(rawQuery: Usgs3DepPointQuery): Promise<Usgs3DepElevationPointResult> {
    if (!this.enabled) {
      throw new Usgs3DepDisabledError();
    }

    const query = Usgs3DepPointQuerySchema.parse(rawQuery);
    validateUsgsCoordinates(query.x, query.y);

    if (this.seedMode) {
      return this.resolveSeedPoint(query);
    }

    return this.fetchLiveElevation(query);
  }

  /**
   * Retrieves elevations for an array of coordinate points.
   * Constrained by Usgs3DepBatchQuerySchema (max 100 queries).
   */
  async getElevations(
    rawQueries: readonly Usgs3DepPointQuery[]
  ): Promise<Usgs3DepElevationPointResult[]> {
    if (!this.enabled) {
      throw new Usgs3DepDisabledError();
    }
    const queries = Usgs3DepBatchQuerySchema.parse(rawQueries);
    return Promise.all(queries.map((q) => this.getElevation(q)));
  }

  /**
   * Calculates terrain slope between two coordinate points.
   */
  async getSlope(p1: Usgs3DepPointQuery, p2: Usgs3DepPointQuery): Promise<Usgs3DepSlopeResult> {
    if (!this.enabled) {
      throw new Usgs3DepDisabledError();
    }

    const [elev1, elev2] = await Promise.all([this.getElevation(p1), this.getElevation(p2)]);

    const slope = calculateTerrainSlope(
      { x: elev1.point.x, y: elev1.point.y, elevationMeters: elev1.elevation_meters },
      { x: elev2.point.x, y: elev2.point.y, elevationMeters: elev2.elevation_meters }
    );

    return Usgs3DepSlopeResultSchema.parse({
      start_point: { x: elev1.point.x, y: elev1.point.y },
      end_point: { x: elev2.point.x, y: elev2.point.y },
      horizontal_distance_meters: slope.horizontalDistanceMeters,
      elevation_change_meters: slope.elevationChangeMeters,
      slope_percent: slope.slopePercent,
      slope_degrees: slope.slopeDegrees,
      provenance: elev1.provenance,
      provenance_start: elev1.provenance,
      provenance_end: elev2.provenance,
      advisory_disclaimer: USGS_3DEP_ADVISORY_DISCLAIMER,
    });
  }

  private resolveSeedPoint(query: Usgs3DepPointQuery): Usgs3DepElevationPointResult {
    const points = this.loadPoints();

    // 1. Exact coordinate match (within 0.0001 deg ~ 11m)
    let matched = points.find(
      (p) => Math.abs(p.x - query.x) < 0.0001 && Math.abs(p.y - query.y) < 0.0001
    );

    // 2. Nearest point search (within 0.2 deg ~ 22km)
    if (!matched) {
      let minDistance = Number.POSITIVE_INFINITY;
      for (const p of points) {
        const dist = Math.hypot(p.x - query.x, p.y - query.y);
        if (dist < minDistance && dist < 0.2) {
          minDistance = dist;
          matched = p;
        }
      }
    }

    const provenance = createUsgs3DepProvenance(this.clock, 'seed');

    // If point is not found in seed coverage, return off-coverage unavailable estimate
    if (!matched || matched.is_off_coverage) {
      const unavailableEstimate: EconomicEstimate = {
        status: 'unavailable',
        reason:
          'USGS 3DEP elevation unavailable: point is outside coverage area or water body (-1000000 off-coverage)',
      };

      return Usgs3DepElevationPointResultSchema.parse({
        point: { x: query.x, y: query.y },
        elevation: unavailableEstimate,
        elevation_meters: unavailableEstimate,
        elevation_feet: unavailableEstimate,
        data_source: matched?.data_source ?? 'Unavailable',
        vertical_datum: 'unknown',
        horizontal_datum: 'NAD83',
        query_units: query.units,
        is_off_coverage: true,
        provenance,
        advisory_disclaimer: USGS_3DEP_ADVISORY_DISCLAIMER,
      });
    }

    const selectedElevation =
      query.units === 'Feet' ? matched.elevation_feet : matched.elevation_meters;

    return Usgs3DepElevationPointResultSchema.parse({
      point: { x: query.x, y: query.y },
      elevation: selectedElevation,
      elevation_meters: matched.elevation_meters,
      elevation_feet: matched.elevation_feet,
      data_source: matched.data_source,
      vertical_datum: matched.vertical_datum,
      horizontal_datum: 'NAD83',
      query_units: query.units,
      is_off_coverage: false,
      provenance,
      advisory_disclaimer: USGS_3DEP_ADVISORY_DISCLAIMER,
    });
  }

  private async fetchLiveElevation(
    query: Usgs3DepPointQuery
  ): Promise<Usgs3DepElevationPointResult> {
    if (!this.allowLiveCalls) {
      throw new Usgs3DepSeedModeViolationError();
    }

    validateEpqsEndpoint(this.endpointUrl);

    const url = new URL(this.endpointUrl);
    url.searchParams.set('x', String(query.x));
    url.searchParams.set('y', String(query.y));
    url.searchParams.set('units', query.units);
    url.searchParams.set('wkid', '4326');

    const response = await pinnedFetch(url, {
      headers: {
        Accept: 'application/json',
      },
      allowedHosts: ['epqs.nationalmap.gov'],
      allowedPaths: [
        {
          host: 'epqs.nationalmap.gov',
          pathPrefix: '/v1/json',
        },
      ],
      timeoutMs: 10000,
      maxBytes: 1024 * 1024,
      ...this.pinnedFetchOptions,
    });

    if (!response.ok) {
      throw new Error(
        `USGS EPQS endpoint returned HTTP ${response.status}: ${response.statusText}`
      );
    }

    const rawJson = await response.json();
    const validatedWire = RawUsgsEpqsResponseSchema.parse(rawJson);
    const queryResult = validatedWire.USGS_Elevation_Point_Query_Service.Elevation_Query;

    const parsed = parseUsgsRawElevation(queryResult.Elevation, query.units);

    const provenance = createUsgs3DepProvenance(this.clock, 'live');

    return Usgs3DepElevationPointResultSchema.parse({
      point: { x: query.x, y: query.y },
      elevation: query.units === 'Feet' ? parsed.elevationFeet : parsed.elevationMeters,
      elevation_meters: parsed.elevationMeters,
      elevation_feet: parsed.elevationFeet,
      data_source: queryResult.Data_Source || (parsed.isOffCoverage ? 'Unavailable' : '3DEP'),
      vertical_datum: parsed.isOffCoverage ? 'unknown' : 'NAVD88',
      horizontal_datum: 'NAD83',
      query_units: query.units,
      is_off_coverage: parsed.isOffCoverage,
      provenance,
      advisory_disclaimer: USGS_3DEP_ADVISORY_DISCLAIMER,
    });
  }
}
