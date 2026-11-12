import fs from 'node:fs';
import {
  DOT_BTS_BASE_URL,
  DOT_BTS_DATA_HORIZON,
  DOT_BTS_DEFAULT_VINTAGE,
  DOT_BTS_SCREENING_DISCLAIMER,
  type DataProvenance,
  type DotBtsAccessibilityRecord,
  DotBtsAccessibilityRecordSchema,
  type DotBtsFixtureDataset,
  DotBtsFixtureDatasetSchema,
  type DotBtsQuery,
  type DotBtsQueryResult,
  DotBtsQueryResultSchema,
  DotBtsQuerySchema,
  type ParsedDotBtsQuery,
  RawDotBtsRowSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  classifyDotBtsAccessibilityTier,
  classifyDotBtsFreightExposure,
  matchesDotBtsGeography,
  parseDotBtsMeasurement,
  validateDotBtsEndpoint,
  validateDotBtsGeography,
} from '@gev/economic';
import { type PinnedFetchOptions, pinnedFetch } from '@gev/security';
import { z } from 'zod';
import { resolveFixturePath } from './opensky.js';

export const DOT_BTS_PROVIDER_ID = 'dot-bts-access' as const;
export const DOT_BTS_FEED_ID = 'transportation-accessibility' as const;
export const DOT_BTS_SEED_FIXTURE_ID = 'dot-bts-synthetic-v1' as const;
export const DOT_BTS_DEFAULT_DATASET_ID = 'ye4a-f2v9' as const;

export class DotBtsDisabledError extends Error {
  constructor() {
    super('DOT/BTS accessibility provider is disabled by the GEV_DOT_BTS_ENABLED kill switch');
    this.name = 'DotBtsDisabledError';
  }
}

export class DotBtsSeedModeViolationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Live DOT/BTS API requests require explicit developer authorization and are prohibited in seed mode (PLAN.md §2 Principle 4 & §10 Task 11.4)'
    );
    this.name = 'DotBtsSeedModeViolationError';
  }
}

export interface DotBtsAdapterOptions {
  clock?: SimClock;
  fixturePath?: string;
  enabled?: boolean;
  seedMode?: boolean;
  allowLiveCalls?: boolean;
  endpointUrl?: string;
  pinnedFetchOptions?: Partial<PinnedFetchOptions>;
}

function createDotBtsProvenance(clock: SimClock, mode: 'seed' | 'live'): DataProvenance {
  const nowIso = new Date(clock.now()).toISOString();
  return {
    schema_version: 1,
    source: {
      provider_id: DOT_BTS_PROVIDER_ID,
      feed_id: DOT_BTS_FEED_ID,
      name: 'U.S. DOT / Bureau of Transportation Statistics (BTS)',
      canonical_url: DOT_BTS_BASE_URL,
    },
    retrieved_at: nowIso,
    observation_period: {
      status: 'available',
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-12-31T23:59:59.000Z',
    },
    vintage: {
      status: 'available',
      value: DOT_BTS_DEFAULT_VINTAGE,
    },
    mode,
    source_mode: mode,
    license: {
      id: 'us-government-public-domain',
      name: 'U.S. Government Work - 17 U.S.C. 105 (Public Domain)',
    },
    attribution: 'U.S. Department of Transportation, Bureau of Transportation Statistics',
    fixture_id: mode === 'seed' ? DOT_BTS_SEED_FIXTURE_ID : null,
    cache: null,
    freshness: {
      status: 'fresh',
      age_seconds: 0,
      fresh_for_seconds: 2592000,
    },
  };
}

/**
 * DOT/BTS Transportation Accessibility Provider Adapter.
 * Implements PLAN.md §10 Task 11.4 and ADR 0065.
 * - Seed mode default (GEV_SEED_MODE=1) with zero live calls.
 * - Kill switch GEV_DOT_BTS_ENABLED fails closed.
 * - Non-coercion of uncovered/missing transportation metrics.
 */
export class DotBtsAdapter {
  readonly clock: SimClock;
  private readonly fixturePath: string;
  private readonly enabled: boolean;
  private readonly seedMode: boolean;
  private readonly allowLiveCalls: boolean;
  private readonly endpointUrl: string;
  private readonly pinnedFetchOptions: Partial<PinnedFetchOptions>;
  private cachedFixture: DotBtsFixtureDataset | null = null;

  constructor(options: DotBtsAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.fixturePath = options.fixturePath ?? resolveFixturePath('dot-bts-synthetic-v1.json');
    this.enabled = options.enabled ?? process.env.GEV_DOT_BTS_ENABLED !== '0';
    this.seedMode = options.seedMode ?? process.env.GEV_SEED_MODE !== '0';
    this.allowLiveCalls = options.allowLiveCalls ?? false;
    this.endpointUrl = options.endpointUrl ?? DOT_BTS_BASE_URL;
    this.pinnedFetchOptions = options.pinnedFetchOptions ?? {};

    validateDotBtsEndpoint(this.endpointUrl);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isSeedMode(): boolean {
    return this.seedMode;
  }

  getScreeningDisclaimer(): string {
    return DOT_BTS_SCREENING_DISCLAIMER;
  }

  loadFixture(): DotBtsFixtureDataset {
    if (this.cachedFixture) {
      return this.cachedFixture;
    }
    if (!fs.existsSync(this.fixturePath)) {
      throw new Error(`DOT/BTS seed fixture not found at '${this.fixturePath}'`);
    }
    const stat = fs.statSync(this.fixturePath);
    if (stat.size > 20_000_000) {
      throw new Error(`DOT/BTS fixture file exceeds 20MB limit: ${stat.size} bytes`);
    }
    const raw = fs.readFileSync(this.fixturePath, 'utf8');
    const parsed = JSON.parse(raw);
    const validated = DotBtsFixtureDatasetSchema.parse(parsed);
    this.cachedFixture = validated;
    return validated;
  }

  async queryAccessibility(rawQuery: DotBtsQuery): Promise<DotBtsQueryResult> {
    if (!this.enabled) {
      throw new DotBtsDisabledError();
    }

    const query = DotBtsQuerySchema.parse(rawQuery);
    validateDotBtsGeography(query.geography);

    if (this.seedMode) {
      return this.resolveSeedQuery(query);
    }

    return this.fetchLiveAccessibility(query);
  }

  private resolveSeedQuery(query: ParsedDotBtsQuery): DotBtsQueryResult {
    const fixture = this.loadFixture();
    const matched = fixture.records.filter((r) =>
      matchesDotBtsGeography(r, query.geography, query.radius_km)
    );

    const provenance = createDotBtsProvenance(this.clock, 'seed');
    const records: DotBtsAccessibilityRecord[] = matched.map((r) => ({
      ...r,
      provenance,
    }));

    return DotBtsQueryResultSchema.parse({
      geography: query.geography,
      data_horizon: DOT_BTS_DATA_HORIZON,
      records,
      provenance,
      advisory_disclaimer: DOT_BTS_SCREENING_DISCLAIMER,
    });
  }

  private async fetchLiveAccessibility(query: ParsedDotBtsQuery): Promise<DotBtsQueryResult> {
    if (!this.allowLiveCalls) {
      throw new DotBtsSeedModeViolationError();
    }

    const datasetId = query.dataset_id ?? DOT_BTS_DEFAULT_DATASET_ID;
    const base = this.endpointUrl.endsWith('/') ? this.endpointUrl.slice(0, -1) : this.endpointUrl;
    const url = new URL(`${base}/${datasetId}.json`);
    url.searchParams.set('$limit', '50');
    if (query.geography.level === 'county') {
      url.searchParams.set('county_fips', query.geography.county_fips);
    } else if (query.geography.level === 'state') {
      url.searchParams.set('state_fips', query.geography.state_fips);
    }

    const response = await pinnedFetch(url, {
      headers: { Accept: 'application/json' },
      allowedHosts: ['data.bts.gov'],
      allowedPaths: [{ host: 'data.bts.gov', pathPrefix: '/resource' }],
      timeoutMs: 10_000,
      maxBytes: 5 * 1024 * 1024,
      ...this.pinnedFetchOptions,
    });

    if (!response.ok) {
      throw new Error(`DOT/BTS endpoint returned HTTP ${response.status}: ${response.statusText}`);
    }

    const rawJson = await response.json();
    const rows = z.array(RawDotBtsRowSchema).parse(rawJson);
    const provenance = createDotBtsProvenance(this.clock, 'live');

    const records: DotBtsAccessibilityRecord[] = rows.map((row) => {
      const interstate = parseDotBtsMeasurement(row.nearest_interstate_km, 'km', true);
      const transitDist = parseDotBtsMeasurement(row.nearest_transit_stop_km, 'km', true);
      const transitCount = parseDotBtsMeasurement(row.transit_stops_within_1km, 'count', true);
      const freightDist = parseDotBtsMeasurement(row.freight_corridor_distance_km, 'km', true);
      const roadDensity = parseDotBtsMeasurement(
        row.walkable_road_density_km_per_sqkm,
        'km/sqkm',
        true
      );
      const commute = parseDotBtsMeasurement(row.commute_mean_minutes, 'minutes', true);

      const isCovered =
        interstate.status === 'available' ||
        transitDist.status === 'available' ||
        roadDensity.status === 'available';

      const geography =
        row.county_fips && /^[0-9]{5}$/.test(row.county_fips)
          ? {
              level: 'county' as const,
              county_fips: row.county_fips,
              state_fips: row.county_fips.slice(0, 2),
            }
          : query.geography;

      return DotBtsAccessibilityRecordSchema.parse({
        geography,
        nearest_interstate_km: interstate,
        nearest_transit_stop_km: transitDist,
        transit_stops_within_1km: transitCount,
        freight_corridor_distance_km: freightDist,
        walkable_road_density_km_per_sqkm: roadDensity,
        commute_mean_minutes: commute,
        accessibility_tier: isCovered
          ? classifyDotBtsAccessibilityTier(transitDist, transitCount, roadDensity)
          : 'unavailable',
        freight_exposure: isCovered ? classifyDotBtsFreightExposure(freightDist) : 'unavailable',
        is_covered: isCovered,
        data_horizon: DOT_BTS_DATA_HORIZON,
        provenance,
        advisory_disclaimer: DOT_BTS_SCREENING_DISCLAIMER,
      });
    });

    return DotBtsQueryResultSchema.parse({
      geography: query.geography,
      data_horizon: DOT_BTS_DATA_HORIZON,
      records,
      provenance,
      advisory_disclaimer: DOT_BTS_SCREENING_DISCLAIMER,
    });
  }
}
