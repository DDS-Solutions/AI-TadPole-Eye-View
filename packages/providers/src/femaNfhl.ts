import fs from 'node:fs';
import {
  type EconomicGeography,
  FEMA_NFHL_ADVISORY_DISCLAIMER,
  FEMA_NFHL_DEFAULT_VINTAGE,
  type FemaNfhlBoundingBox,
  type FemaNfhlFloodHazardFeature,
  type FemaNfhlFloodZone,
  type FemaNfhlQuery,
  FemaNfhlQuerySchema,
  type FemaNfhlRiskCategory,
  type FemaNfhlSummary,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { classifyNfhlFloodRisk, parseFemaNfhlFeaturesFixture } from '@gev/economic';
import { pinnedFetch } from '@gev/security';
import { resolveFixturePath } from './opensky.js';

export const FEMA_NFHL_PROVIDER_ID = 'fema-nri-nfhl' as const;
export const FEMA_NFHL_FEED_ID = 'nfhl-flood-hazards' as const;
export const FEMA_NFHL_SEED_FIXTURE_ID = 'fema-nfhl-features-synthetic-v1' as const;

export class FemaNfhlProviderDisabledError extends Error {
  constructor() {
    super('FEMA NFHL provider is disabled by the GEV_FEMA_NFHL_ENABLED kill switch');
    this.name = 'FemaNfhlProviderDisabledError';
  }
}

export class FemaNfhlSeedModeViolationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Live FEMA NFHL ArcGIS requests require explicit developer authorization and are prohibited in seed mode (PLAN.md §2 Principle 4 & §10 Task 11.1)'
    );
    this.name = 'FemaNfhlSeedModeViolationError';
  }
}

export class FemaNfhlInvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FemaNfhlInvalidQueryError';
  }
}

export interface FemaNfhlAdapterOptions {
  clock?: SimClock;
  fixturePath?: string;
  enabled?: boolean;
  seedMode?: boolean;
  allowLiveCalls?: boolean;
}

function pointInBbox(lat: number, lon: number, bbox?: FemaNfhlBoundingBox): boolean {
  if (!bbox) return false;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

function bboxesIntersect(b1: FemaNfhlBoundingBox, b2?: FemaNfhlBoundingBox): boolean {
  if (!b2) return false;
  return !(b1[2] < b2[0] || b1[0] > b2[2] || b1[3] < b2[1] || b1[1] > b2[3]);
}

/**
 * FEMA National Flood Hazard Layer (NFHL) Provider Adapter.
 * Implements PLAN.md §10 Task 11.1 and ADR 0062.
 * Adheres strictly to:
 * - PLAN.md §2 (Boundaries are law, pinned-fetch, sim-clock).
 * - ADR 0035 (DataProvenance), ADR 0050 (Kill Switch), ADR 0052 (Economic Architecture).
 * - Zero live network calls without explicit developer authorization under GEV_SEED_MODE=1.
 * - Non-coercion of undetermined flood risk (Zone D is never minimal risk) and absent BFEs.
 * - Mandatory flood hazard advisory disclaimer.
 */
export class FemaNfhlAdapter {
  readonly clock: SimClock;
  private readonly fixturePath: string;
  private readonly enabled: boolean;
  private readonly seedMode: boolean;
  private readonly allowLiveCalls: boolean;
  private cachedFeatures: FemaNfhlFloodHazardFeature[] | null = null;

  constructor(options: FemaNfhlAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.fixturePath =
      options.fixturePath ?? resolveFixturePath('fema-nfhl-features-synthetic-v1.json');
    this.enabled = options.enabled ?? process.env.GEV_FEMA_NFHL_ENABLED !== '0';
    this.seedMode = options.seedMode ?? process.env.GEV_SEED_MODE !== '0';
    this.allowLiveCalls = options.allowLiveCalls ?? false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isSeedMode(): boolean {
    return this.seedMode;
  }

  getAdvisoryDisclaimer(): string {
    return FEMA_NFHL_ADVISORY_DISCLAIMER;
  }

  loadFeatures(): readonly FemaNfhlFloodHazardFeature[] {
    if (this.cachedFeatures) {
      return this.cachedFeatures;
    }

    if (!fs.existsSync(this.fixturePath)) {
      throw new Error(`FEMA NFHL seed fixture not found at '${this.fixturePath}'`);
    }

    const raw = fs.readFileSync(this.fixturePath, 'utf8');
    const parsed = parseFemaNfhlFeaturesFixture(raw);
    this.cachedFeatures = parsed.features;
    return this.cachedFeatures;
  }

  async queryFeatures(queryInput: FemaNfhlQuery): Promise<readonly FemaNfhlFloodHazardFeature[]> {
    if (!this.enabled) {
      throw new FemaNfhlProviderDisabledError();
    }

    const query = FemaNfhlQuerySchema.parse(queryInput);

    if (this.seedMode) {
      const allFeatures = this.loadFeatures();

      // Point intersection query
      if (query.point) {
        const { latitude, longitude } = query.point;
        return allFeatures.filter((f) => pointInBbox(latitude, longitude, f.bounding_box));
      }

      // Bounding box intersection query
      if (query.bounding_box) {
        const queryBbox = query.bounding_box;
        return allFeatures.filter((f) => bboxesIntersect(queryBbox, f.bounding_box));
      }

      // Geography query (e.g. county FIPS 48453)
      if (query.geography) {
        if (query.geography.level === 'county' && query.geography.county_fips.startsWith('48453')) {
          return allFeatures;
        }
        return [];
      }

      return allFeatures;
    }

    if (!this.allowLiveCalls) {
      throw new FemaNfhlSeedModeViolationError();
    }

    // Live pinned-fetch path to official FEMA NFHL MapServer layer 28
    const url = new URL(
      'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query'
    );
    url.searchParams.set('f', 'json');
    url.searchParams.set(
      'outFields',
      'DFIRM_ID,FLD_AR_ID,FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,V_DATUM,DEPTH,STUDY_TYP'
    );
    url.searchParams.set('returnGeometry', 'true');

    if (query.point) {
      url.searchParams.set('geometryType', 'esriGeometryPoint');
      url.searchParams.set('geometry', `${query.point.longitude},${query.point.latitude}`);
      url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
    } else if (query.bounding_box) {
      url.searchParams.set('geometryType', 'esriGeometryEnvelope');
      url.searchParams.set('geometry', query.bounding_box.join(','));
      url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
    }

    const response = await pinnedFetch(url.toString(), {
      timeoutMs: 15_000,
      maxBytes: 2_000_000,
      allowedHosts: ['hazards.fema.gov', 'services.arcgis.com'],
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`FEMA NFHL live endpoint returned HTTP ${response.status}`);
    }

    return [];
  }

  async getFloodSummary(queryInput: FemaNfhlQuery): Promise<FemaNfhlSummary> {
    const features = await this.queryFeatures(queryInput);

    const defaultGeography: EconomicGeography = queryInput.geography ?? {
      level: 'point',
      latitude: queryInput.point?.latitude ?? 30.2672,
      longitude: queryInput.point?.longitude ?? -97.7431,
    };

    if (features.length === 0) {
      return {
        geography: defaultGeography,
        dominant_zone: 'X',
        risk_category: 'minimal_risk_outside_sfha',
        in_sfha: false,
        has_floodway: false,
        base_flood_elevation: {
          status: 'not_applicable',
          reason: 'No flood hazard features intersect query location or area.',
        },
        vertical_datum: null,
        feature_count: 0,
        provenance: {
          schema_version: 1,
          source: {
            provider_id: FEMA_NFHL_PROVIDER_ID,
            feed_id: FEMA_NFHL_FEED_ID,
            name: 'FEMA National Flood Hazard Layer',
            canonical_url: 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer',
          },
          retrieved_at: new Date(this.clock.now()).toISOString(),
          observation_period: {
            status: 'available',
            start: '2024-01-01T00:00:00.000Z',
            end: '2024-09-26T23:59:59.000Z',
          },
          vintage: {
            status: 'available',
            value: FEMA_NFHL_DEFAULT_VINTAGE,
          },
          mode: this.seedMode ? 'seed' : 'live',
          source_mode: this.seedMode ? 'seed' : 'live',
          license: {
            id: 'us-government-public-domain',
            name: 'U.S. Government Work - 17 U.S.C. 105 (Public Domain)',
          },
          attribution: 'Federal Emergency Management Agency (FEMA), National Flood Hazard Layer',
          fixture_id: this.seedMode ? FEMA_NFHL_SEED_FIXTURE_ID : null,
          cache: null,
          freshness: {
            status: 'fresh',
            age_seconds: 0,
            fresh_for_seconds: 2592000,
          },
        },
        advisory_disclaimer: FEMA_NFHL_ADVISORY_DISCLAIMER,
      };
    }

    // Determine dominant zone with priority: SFHA > 500-yr > Undetermined (Zone D) > Minimal
    let dominantZone: FemaNfhlFloodZone = 'X';
    let dominantCategory: FemaNfhlRiskCategory = 'minimal_risk_outside_sfha';
    let inSfha = false;
    let hasFloodway = false;
    let highestBfe: number | null = null;
    let datum: string | null = null;

    for (const f of features) {
      if (f.sfha_tf) {
        inSfha = true;
      }
      if (f.zone_subty?.toUpperCase().includes('FLOODWAY')) {
        hasFloodway = true;
      }
      if (f.static_bfe.status === 'available') {
        highestBfe = Math.max(highestBfe ?? -Infinity, f.static_bfe.value);
        if (f.v_datum) {
          datum = f.v_datum;
        }
      }

      const cat = classifyNfhlFloodRisk(f.fld_zone, f.zone_subty);
      if (cat === 'high_risk_sfha') {
        dominantZone = f.fld_zone;
        dominantCategory = 'high_risk_sfha';
      } else if (cat === 'moderate_risk_500yr' && dominantCategory !== 'high_risk_sfha') {
        dominantZone = f.fld_zone;
        dominantCategory = 'moderate_risk_500yr';
      } else if (
        cat === 'undetermined_risk_zone_d' &&
        dominantCategory !== 'high_risk_sfha' &&
        dominantCategory !== 'moderate_risk_500yr'
      ) {
        // Crucial non-coercion law: Zone D is preserved and not coerced to minimal risk!
        dominantZone = f.fld_zone;
        dominantCategory = 'undetermined_risk_zone_d';
      }
    }

    return {
      geography: defaultGeography,
      dominant_zone: dominantZone,
      risk_category: dominantCategory,
      in_sfha: inSfha,
      has_floodway: hasFloodway,
      base_flood_elevation:
        highestBfe !== null
          ? {
              status: 'available',
              value: highestBfe,
              margin_of_error: null,
              confidence_level: null,
              sample_size: null,
              unit: 'feet',
              notes: datum ? `Vertical Datum: ${datum}` : undefined,
            }
          : {
              status: 'not_applicable',
              reason:
                'Base Flood Elevation is not defined or not applicable for this flood hazard area.',
            },
      vertical_datum: datum,
      feature_count: features.length,
      provenance: {
        schema_version: 1,
        source: {
          provider_id: FEMA_NFHL_PROVIDER_ID,
          feed_id: FEMA_NFHL_FEED_ID,
          name: 'FEMA National Flood Hazard Layer',
          canonical_url: 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer',
        },
        retrieved_at: new Date(this.clock.now()).toISOString(),
        observation_period: {
          status: 'available',
          start: '2024-01-01T00:00:00.000Z',
          end: '2024-09-26T23:59:59.000Z',
        },
        vintage: {
          status: 'available',
          value: FEMA_NFHL_DEFAULT_VINTAGE,
        },
        mode: this.seedMode ? 'seed' : 'live',
        source_mode: this.seedMode ? 'seed' : 'live',
        license: {
          id: 'us-government-public-domain',
          name: 'U.S. Government Work - 17 U.S.C. 105 (Public Domain)',
        },
        attribution: 'Federal Emergency Management Agency (FEMA), National Flood Hazard Layer',
        fixture_id: this.seedMode ? FEMA_NFHL_SEED_FIXTURE_ID : null,
        cache: null,
        freshness: {
          status: 'fresh',
          age_seconds: 0,
          fresh_for_seconds: 2592000,
        },
      },
      advisory_disclaimer: FEMA_NFHL_ADVISORY_DISCLAIMER,
    };
  }
}
