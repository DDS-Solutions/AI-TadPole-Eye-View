import fs from 'node:fs';
import {
  type BoundingBox,
  type DataProvenance,
  type EconomicEvidenceRecord,
  OSM_COMMERCIAL_CACHE_TTL_SEC,
  OSM_COMMERCIAL_MIN_REQUEST_INTERVAL_MS,
  OSM_ODBL_ATTRIBUTION,
  OSM_ODBL_LEGAL_DISCLAIMER,
  OSM_ODBL_LICENSE_ID,
  OSM_ODBL_LICENSE_NAME,
  type OsmCommercialCategory,
  type OsmCommercialEnrichmentResponse,
  OsmCommercialEnrichmentResponseSchema,
  type OsmCommercialFootprintSummary,
  type OsmCommercialPoiFeature,
  type OsmCommercialQuery,
  OsmCommercialQuerySchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  calculateOsmCommercialSummary,
  extractCommercialFeatures,
  generateOsmCommercialEvidenceRecords,
  parseOsmCommercialPoiFixture,
} from '@gev/economic';
import { buildSanitizedOsmCommercialOverpassQuery, pinnedFetch } from '@gev/security';
import { resolveFixturePath } from './opensky.js';
import {
  createDataProvenance,
  observationPeriodFromIso,
  unavailableObservationPeriod,
} from './provenance.js';

export const OSM_COMMERCIAL_PROVIDER_ID = 'osm-commercial' as const;
export const OSM_COMMERCIAL_FEED_ID = 'overpass-commercial-poi' as const;
export const OSM_COMMERCIAL_SEED_FIXTURE_ID = 'osm-commercial-synthetic-v1' as const;
export const OSM_COMMERCIAL_EVIDENCE_FIXTURE_ID = 'osm-commercial-evidence-synthetic-v1' as const;

export class OsmCommercialProviderDisabledError extends Error {
  constructor() {
    super('OSM Commercial provider is disabled by the GEV_OSM_COMMERCIAL_ENABLED kill switch');
    this.name = 'OsmCommercialProviderDisabledError';
  }
}

export class OsmCommercialSeedModeViolationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Live Overpass API requests require explicit developer authorization and are prohibited in seed mode (PLAN.md §2 Principle 4 & §10 Task 9.3)'
    );
    this.name = 'OsmCommercialSeedModeViolationError';
  }
}

export class OsmCommercialInvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OsmCommercialInvalidQueryError';
  }
}

export class OsmCommercialProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OsmCommercialProvenanceError';
  }
}

export interface OsmCommercialAdapterOptions {
  clock?: SimClock;
  fixturePath?: string;
  evidenceFixturePath?: string;
  enabled?: boolean;
  seedMode?: boolean;
  allowLiveCalls?: boolean;
  cacheTtlMs?: number;
  minRequestIntervalMs?: number;
}

interface CacheEntry {
  response: OsmCommercialEnrichmentResponse;
  cachedAtMs: number;
}

/**
 * OpenStreetMap Commercial & Amenity Infrastructure Provider Adapter.
 *
 * Adheres strictly to:
 * - PLAN.md §2, §3, §8.2, §9.3 & Task 9.3 (OQ-5 Resolution).
 * - ADR 0021 (Overpass Sanitizer), ADR 0035 (DataProvenance), ADR 0050 (Cost Governor/Kill Switch),
 *   ADR 0052 (Pure Economic Engine), ADR 0054 (Prompt Protection).
 * - Mandatory ODbL 1.0 attribution notice and legal disclaimer.
 * - Strict seed mode enforcement: zero network calls without explicit developer authorization.
 * - High performance in-memory caching and extraction < 10ms p95.
 */
export class OsmCommercialAdapter {
  readonly clock: SimClock;
  private readonly fixturePath: string;
  private readonly enabled: boolean;
  private readonly seedMode: boolean;
  private readonly allowLiveCalls: boolean;
  private readonly cacheTtlMs: number;
  private readonly minRequestIntervalMs: number;

  private seedFeaturesCache: OsmCommercialPoiFeature[] | null = null;
  private seedProvenanceCache: DataProvenance | null = null;
  private responseCache: Map<string, CacheEntry> = new Map();
  private lastLiveCallTimestampMs = 0;

  constructor(options: OsmCommercialAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.fixturePath =
      options.fixturePath ?? resolveFixturePath('osm-commercial-synthetic-v1.json');
    this.enabled = options.enabled ?? process.env.GEV_OSM_COMMERCIAL_ENABLED !== '0';

    const envSeed = process.env.GEV_SEED_MODE;
    const envLive = process.env.GEV_LIVE_MODE;
    this.seedMode =
      options.seedMode ?? (envSeed === '1' || envLive !== '1' || process.env.NODE_ENV === 'test');
    this.allowLiveCalls = options.allowLiveCalls ?? false;
    this.cacheTtlMs = options.cacheTtlMs ?? OSM_COMMERCIAL_CACHE_TTL_SEC * 1000;
    this.minRequestIntervalMs =
      options.minRequestIntervalMs ?? OSM_COMMERCIAL_MIN_REQUEST_INTERVAL_MS;
  }

  /**
   * Asserts provider is enabled; throws if disabled by kill switch.
   */
  private assertEnabled(): void {
    if (!this.enabled) {
      throw new OsmCommercialProviderDisabledError();
    }
  }

  /**
   * Generates a deterministic cache key for a commercial query.
   */
  private getCacheKey(query: OsmCommercialQuery): string {
    const { min_lat, min_lon, max_lat, max_lon } = query.bbox;
    const cats = query.categories ? [...query.categories].sort().join(',') : 'all';
    const term = query.search_term ?? '';
    return `${min_lat.toFixed(4)}:${min_lon.toFixed(4)}:${max_lat.toFixed(4)}:${max_lon.toFixed(4)}|${cats}|${term}`;
  }

  /**
   * Loads and extracts features from the verified seed fixture in memory.
   */
  private loadSeedData(): {
    features: OsmCommercialPoiFeature[];
    provenance: DataProvenance;
  } {
    if (this.seedFeaturesCache && this.seedProvenanceCache) {
      return {
        features: this.seedFeaturesCache,
        provenance: this.seedProvenanceCache,
      };
    }

    const raw = fs.readFileSync(this.fixturePath, 'utf8');
    const parsed = parseOsmCommercialPoiFixture(raw);

    const features = extractCommercialFeatures(parsed.elements);
    this.seedFeaturesCache = features;
    this.seedProvenanceCache = parsed.provenance;

    return { features, provenance: parsed.provenance };
  }

  /**
   * Executes a commercial enrichment query across the bounded AOI.
   */
  async queryCommercialEnrichment(
    rawQuery: OsmCommercialQuery
  ): Promise<OsmCommercialEnrichmentResponse> {
    this.assertEnabled();

    const queryParsed = OsmCommercialQuerySchema.safeParse(rawQuery);
    if (!queryParsed.success) {
      throw new OsmCommercialInvalidQueryError(
        `Invalid OSM commercial query: ${queryParsed.error.message}`
      );
    }
    const query = queryParsed.data;
    const cacheKey = this.getCacheKey(query);

    // Check in-memory cache
    const cached = this.responseCache.get(cacheKey);
    const nowMs = this.clock.now();
    if (cached && nowMs - cached.cachedAtMs < this.cacheTtlMs) {
      return cached.response;
    }

    if (this.seedMode) {
      return this.executeSeedQuery(query, cacheKey, nowMs);
    }

    if (!this.allowLiveCalls) {
      throw new OsmCommercialSeedModeViolationError();
    }

    return this.executeLiveQuery(query, cacheKey, nowMs);
  }

  /**
   * Executes pure in-memory query against seed fixture elements.
   */
  private executeSeedQuery(
    query: OsmCommercialQuery,
    cacheKey: string,
    nowMs: number
  ): OsmCommercialEnrichmentResponse {
    const { features, provenance } = this.loadSeedData();
    const { min_lat, min_lon, max_lat, max_lon } = query.bbox;

    // Filter features spatially and by category / search term
    const matchedFeatures = features.filter((f) => {
      if (f.lat < min_lat || f.lat > max_lat || f.lon < min_lon || f.lon > max_lon) {
        return false;
      }
      if (query.categories && query.categories.length > 0) {
        if (!query.categories.includes(f.category)) {
          return false;
        }
      }
      if (query.search_term && query.search_term.length > 0) {
        const term = query.search_term.toLowerCase();
        const matchesName = f.name.toLowerCase().includes(term);
        const matchesBrand = f.brand?.toLowerCase().includes(term) ?? false;
        if (!matchesName && !matchesBrand) {
          return false;
        }
      }
      return true;
    });

    const summary: OsmCommercialFootprintSummary = calculateOsmCommercialSummary(
      matchedFeatures,
      query.bbox
    );
    const evidenceRecords: EconomicEvidenceRecord[] = generateOsmCommercialEvidenceRecords(
      summary,
      query.bbox,
      provenance
    );

    const response: OsmCommercialEnrichmentResponse = OsmCommercialEnrichmentResponseSchema.parse({
      query,
      features: matchedFeatures,
      summary,
      evidence_records: evidenceRecords,
      provenance,
      disclaimer: OSM_ODBL_LEGAL_DISCLAIMER,
    });

    this.responseCache.set(cacheKey, { response, cachedAtMs: nowMs });
    return response;
  }

  /**
   * Executes live Overpass API query through sanitizer, pinned-fetch, and cache path.
   */
  private async executeLiveQuery(
    query: OsmCommercialQuery,
    cacheKey: string,
    nowMs: number
  ): Promise<OsmCommercialEnrichmentResponse> {
    // Rate limit throttling
    const elapsedSinceLast = nowMs - this.lastLiveCallTimestampMs;
    if (elapsedSinceLast < this.minRequestIntervalMs) {
      const waitMs = this.minRequestIntervalMs - elapsedSinceLast;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastLiveCallTimestampMs = this.clock.now();

    const sanitized = buildSanitizedOsmCommercialOverpassQuery({
      bbox: query.bbox,
      categories: query.categories,
      timeoutSec: 25,
    });

    const url = new URL('https://overpass-api.de/api/interpreter');
    const upstreamRes = await pinnedFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: `data=${encodeURIComponent(sanitized.sanitized_ql)}`,
      allowedHosts: ['overpass-api.de', 'overpass.kumi.systems'],
      allowedPaths: [{ host: 'overpass-api.de', pathPrefix: '/api/interpreter' }],
      timeoutMs: sanitized.timeout_sec * 1000,
      maxBytes: 15 * 1024 * 1024,
    });

    if (!upstreamRes.ok) {
      throw new Error(`Overpass API returned HTTP ${upstreamRes.status}`);
    }

    const raw = (await upstreamRes.json()) as {
      elements?: Array<{
        id: number;
        type: string;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
      osm3s?: { timestamp_osm_base?: string };
    };

    const elements = raw.elements ?? [];
    const features = extractCommercialFeatures(elements);
    const summary = calculateOsmCommercialSummary(features, query.bbox);

    const timestamp = raw.osm3s?.timestamp_osm_base;
    const observationPeriod = timestamp
      ? observationPeriodFromIso(timestamp)
      : unavailableObservationPeriod('Overpass response omitted timestamp_osm_base');

    const provenance = createDataProvenance({
      providerId: OSM_COMMERCIAL_PROVIDER_ID,
      feedId: OSM_COMMERCIAL_FEED_ID,
      clock: this.clock,
      sourceMode: 'live',
      observationPeriod,
    });

    // Enforce statutory ODbL attribution notice
    provenance.attribution = OSM_ODBL_ATTRIBUTION;
    provenance.license = {
      id: OSM_ODBL_LICENSE_ID,
      name: OSM_ODBL_LICENSE_NAME,
    };

    const evidenceRecords = generateOsmCommercialEvidenceRecords(summary, query.bbox, provenance);

    const response: OsmCommercialEnrichmentResponse = OsmCommercialEnrichmentResponseSchema.parse({
      query,
      features,
      summary,
      evidence_records: evidenceRecords,
      provenance,
      disclaimer: OSM_ODBL_LEGAL_DISCLAIMER,
    });

    this.responseCache.set(cacheKey, { response, cachedAtMs: this.clock.now() });
    return response;
  }

  /**
   * Convenience: returns structured economic evidence records for an AOI.
   */
  async getCommercialEvidence(query: OsmCommercialQuery): Promise<EconomicEvidenceRecord[]> {
    const res = await this.queryCommercialEnrichment(query);
    return res.evidence_records;
  }

  /**
   * Convenience: returns features filtered by a single category.
   */
  async getFeaturesByCategory(
    category: OsmCommercialCategory,
    bbox: BoundingBox
  ): Promise<OsmCommercialPoiFeature[]> {
    const res = await this.queryCommercialEnrichment({
      bbox,
      categories: [category],
    });
    return res.features;
  }

  /**
   * Convenience: returns footprint summary for a bounding box.
   */
  async getCommercialSummary(bbox: BoundingBox): Promise<OsmCommercialFootprintSummary> {
    const res = await this.queryCommercialEnrichment({ bbox });
    return res.summary;
  }
}
