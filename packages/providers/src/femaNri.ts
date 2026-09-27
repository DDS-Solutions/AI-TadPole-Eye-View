import fs from 'node:fs';
import {
  type EconomicEvidenceRecord,
  type EconomicFixtureDataset,
  EconomicFixtureDatasetSchema,
  type EconomicGeography,
  FEMA_NRI_SCREENING_DISCLAIMER,
  type FemaNriHazardType,
  type FemaNriQuery,
  FemaNriQuerySchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  FEMA_NRI_VARIABLE_DICTIONARY,
  lookupFemaNriVariable,
  validateFemaNriGeography,
} from '@gev/economic';
import { pinnedFetch } from '@gev/security';
import { resolveFixturePath } from './opensky.js';

export const FEMA_NRI_PROVIDER_ID = 'fema-nri-nfhl' as const;
export const FEMA_NRI_FEED_ID = 'nri-composite' as const;
export const FEMA_NRI_SEED_FIXTURE_ID = 'fema-nri-synthetic-v1' as const;

export class FemaNriProviderDisabledError extends Error {
  constructor() {
    super('FEMA NRI provider is disabled by the GEV_FEMA_NRI_ENABLED kill switch');
    this.name = 'FemaNriProviderDisabledError';
  }
}

export class FemaNriSeedModeViolationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Live FEMA NRI API requests require explicit developer authorization and are prohibited in seed mode (PLAN.md §2 Principle 4 & §10 Task 11.1)'
    );
    this.name = 'FemaNriSeedModeViolationError';
  }
}

export class FemaNriInvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FemaNriInvalidQueryError';
  }
}

export interface FemaNriAdapterOptions {
  clock?: SimClock;
  fixturePath?: string;
  enabled?: boolean;
  seedMode?: boolean;
  allowLiveCalls?: boolean;
  apiKey?: string;
}

function getGeographyKey(geo: EconomicGeography): string {
  switch (geo.level) {
    case 'county':
      return `county:${geo.county_fips}`;
    case 'tract':
      return `tract:${geo.tract_fips}`;
    case 'state':
      return `state:${geo.state_fips}`;
    default:
      return `${(geo as { level: string }).level}:unknown`;
  }
}

const HAZARD_METRIC_MAP: Record<FemaNriHazardType, string> = {
  riverine_flooding: 'RFLD_RISKS',
  coastal_flooding: 'CFLD_RISKS',
  hurricane: 'HRCN_RISKS',
  tornado: 'TRND_RISKS',
  wildfire: 'WDFR_RISKS',
  earthquake: 'ERQK_RISKS',
  strong_wind: 'SWND_RISKS',
  heat_wave: 'HWAV_RISKS',
  drought: 'DRGT_RISKS',
  winter_weather: 'WNTW_RISKS',
  hail: 'HAIL_RISKS',
  ice_storm: 'ISTM_RISKS',
  landslide: 'LNDS_RISKS',
  lightning: 'LTNG_RISKS',
  tsunami: 'TSUN_RISKS',
  avalanche: 'AVAL_RISKS',
  cold_wave: 'CWAV_RISKS',
  volcanic_activity: 'VLCN_RISKS',
};

/**
 * FEMA National Risk Index (NRI) Provider Adapter.
 * Implements PLAN.md §10 Task 11.1 and ADR 0062.
 * Adheres strictly to:
 * - PLAN.md §2 (Boundaries are law, pinned-fetch, sim-clock).
 * - ADR 0035 (DataProvenance), ADR 0050 (Kill Switch), ADR 0052 (Economic Architecture).
 * - Zero live network calls without explicit developer authorization under GEV_SEED_MODE=1.
 * - Non-coercion of suppressed or not-applicable hazard ratings.
 * - Mandatory screening disclaimer.
 */
export class FemaNriAdapter {
  readonly clock: SimClock;
  private readonly fixturePath: string;
  private readonly enabled: boolean;
  private readonly seedMode: boolean;
  private readonly allowLiveCalls: boolean;
  private readonly apiKey?: string;
  private cachedDataset: EconomicFixtureDataset | null = null;
  private recordsByGeoKey: Map<string, EconomicEvidenceRecord[]> = new Map();

  constructor(options: FemaNriAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.fixturePath = options.fixturePath ?? resolveFixturePath('fema-nri-synthetic-v1.json');
    this.enabled = options.enabled ?? process.env.GEV_FEMA_NRI_ENABLED !== '0';
    this.seedMode = options.seedMode ?? process.env.GEV_SEED_MODE !== '0';
    this.allowLiveCalls = options.allowLiveCalls ?? false;
    this.apiKey = options.apiKey ?? process.env.GEV_FEMA_API_KEY;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isSeedMode(): boolean {
    return this.seedMode;
  }

  getScreeningDisclaimer(): string {
    return FEMA_NRI_SCREENING_DISCLAIMER;
  }

  getVariableDictionary() {
    return FEMA_NRI_VARIABLE_DICTIONARY;
  }

  loadDataset(): EconomicFixtureDataset {
    if (this.cachedDataset) {
      return this.cachedDataset;
    }

    if (!fs.existsSync(this.fixturePath)) {
      throw new Error(`FEMA NRI seed fixture not found at '${this.fixturePath}'`);
    }

    const raw = fs.readFileSync(this.fixturePath, 'utf8');
    const parsed = JSON.parse(raw);
    const validated = EconomicFixtureDatasetSchema.parse(parsed);

    const index = new Map<string, EconomicEvidenceRecord[]>();
    for (const record of validated.records) {
      const key = getGeographyKey(record.geography);
      const existing = index.get(key) ?? [];
      existing.push(record);
      index.set(key, existing);
    }

    this.cachedDataset = validated;
    this.recordsByGeoKey = index;
    return validated;
  }

  async query(queryInput: FemaNriQuery): Promise<readonly EconomicEvidenceRecord[]> {
    if (!this.enabled) {
      throw new FemaNriProviderDisabledError();
    }

    const query = FemaNriQuerySchema.parse(queryInput);
    validateFemaNriGeography(query.geography);

    if (this.seedMode) {
      this.loadDataset();
      const geoKey = getGeographyKey(query.geography);
      const candidates = this.recordsByGeoKey.get(geoKey) ?? [];

      if (!query.variables || query.variables.length === 0) {
        return candidates;
      }

      const requestedIds = new Set<string>();
      for (const v of query.variables) {
        const resolved = lookupFemaNriVariable(v);
        if (resolved) {
          requestedIds.add(resolved.variable_id);
          requestedIds.add(resolved.metric_id);
        } else {
          requestedIds.add(v);
        }
      }

      return candidates.filter(
        (r) => requestedIds.has(r.variable_name) || requestedIds.has(r.metric_id)
      );
    }

    if (!this.allowLiveCalls) {
      throw new FemaNriSeedModeViolationError();
    }

    // Live pinned-fetch path
    const url = new URL('https://www.fema.gov/api/open/v1/NationalRiskIndex');
    const countyFips = query.geography.level === 'county' ? query.geography.county_fips : undefined;
    if (countyFips) {
      url.searchParams.set('$filter', `countyFips eq '${countyFips}'`);
    }

    const response = await pinnedFetch(url.toString(), {
      timeoutMs: 10_000,
      maxBytes: 1_000_000,
      allowedHosts: ['www.fema.gov', 'services.arcgis.com', 'hazards.fema.gov'],
      headers: {
        Accept: 'application/json',
        ...(this.apiKey ? { 'X-Api-Key': this.apiKey } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`FEMA NRI live endpoint returned HTTP ${response.status}`);
    }

    // Live parsing would adapt OpenFEMA JSON into EconomicEvidenceRecord[]
    // Under seed mode / tests, seedMode is 1.
    return [];
  }

  async getEvidenceByGeography(
    geography: EconomicGeography
  ): Promise<readonly EconomicEvidenceRecord[]> {
    if (!this.enabled) {
      throw new FemaNriProviderDisabledError();
    }
    validateFemaNriGeography(geography);
    this.loadDataset();
    const geoKey = getGeographyKey(geography);
    return this.recordsByGeoKey.get(geoKey) ?? [];
  }

  async getCompositeRisk(
    geography: EconomicGeography
  ): Promise<EconomicEvidenceRecord | undefined> {
    const records = await this.query({
      geography,
      variables: ['RISK_SCORE'],
    });
    return records.find(
      (r) => r.variable_name === 'RISK_SCORE' || r.metric_id === 'nri-composite-risk-score'
    );
  }

  async getExpectedAnnualLoss(
    geography: EconomicGeography
  ): Promise<EconomicEvidenceRecord | undefined> {
    const records = await this.query({
      geography,
      variables: ['EAL_VALT'],
    });
    return records.find(
      (r) => r.variable_name === 'EAL_VALT' || r.metric_id === 'expected-annual-loss-total'
    );
  }

  async getSocialVulnerability(
    geography: EconomicGeography
  ): Promise<EconomicEvidenceRecord | undefined> {
    const records = await this.query({
      geography,
      variables: ['SOVI_SCORE'],
    });
    return records.find(
      (r) => r.variable_name === 'SOVI_SCORE' || r.metric_id === 'social-vulnerability-score'
    );
  }

  async getCommunityResilience(
    geography: EconomicGeography
  ): Promise<EconomicEvidenceRecord | undefined> {
    const records = await this.query({
      geography,
      variables: ['RESL_SCORE'],
    });
    return records.find(
      (r) => r.variable_name === 'RESL_SCORE' || r.metric_id === 'community-resilience-score'
    );
  }

  async getHazardRisk(
    geography: EconomicGeography,
    hazardType: FemaNriHazardType
  ): Promise<EconomicEvidenceRecord | undefined> {
    const varName = HAZARD_METRIC_MAP[hazardType];
    if (!varName) return undefined;

    const records = await this.query({
      geography,
      variables: [varName],
    });
    return records.find((r) => r.variable_name === varName);
  }
}
