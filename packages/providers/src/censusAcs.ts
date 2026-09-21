import fs from 'node:fs';
import {
  type CensusAcsQuery,
  CensusAcsQuerySchema,
  type CensusAcsVariableDictionary,
  type EconomicEvidenceRecord,
  type EconomicFixtureDataset,
  EconomicFixtureDatasetSchema,
  type EconomicGeography,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  CENSUS_ACS_VARIABLE_DICTIONARY_V1,
  lookupAcsVariable,
  validateAcsGeography,
} from '@gev/economic';
import { resolveFixturePath } from './opensky.js';

export const CENSUS_ACS_PROVIDER_ID = 'census-acs' as const;
export const CENSUS_ACS_FEED_ID = 'acs-5yr-profiles' as const;
export const CENSUS_ACS_SEED_FIXTURE_ID = 'census-acs-synthetic-v1' as const;

export class CensusAcsProviderDisabledError extends Error {
  constructor() {
    super('Census ACS provider is disabled by the GEV_CENSUS_ACS_ENABLED kill switch');
    this.name = 'CensusAcsProviderDisabledError';
  }
}

export class CensusAcsSeedModeViolationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Live Census API requests require explicit developer authorization and are prohibited in seed mode (PLAN.md §2 Principle 4 & §10 Task 9.1)'
    );
    this.name = 'CensusAcsSeedModeViolationError';
  }
}

export class CensusAcsInvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CensusAcsInvalidQueryError';
  }
}

export interface CensusAcsAdapterOptions {
  clock?: SimClock;
  fixturePath?: string;
  enabled?: boolean;
  seedMode?: boolean;
  allowLiveCalls?: boolean;
  apiKey?: string;
}

/**
 * Extracts a normalized matching key for an EconomicGeography to enable O(1) index lookups.
 */
function getGeographyKey(geo: EconomicGeography): string {
  switch (geo.level) {
    case 'county':
      return `county:${geo.county_fips}`;
    case 'tract':
      return `tract:${geo.tract_fips}`;
    case 'zcta':
      return `zcta:${geo.zcta}`;
    case 'place':
      return `place:${geo.place_fips}`;
    case 'state':
      return `state:${geo.state_fips}`;
    case 'nation':
      return `nation:${geo.country_code}`;
    default:
      return `${geo.level}:unknown`;
  }
}

/**
 * Census ACS Provider Adapter.
 * Adheres strictly to:
 * - PLAN.md §2 Principle 1 (Boundaries are law) & §8.2 (Economic R1).
 * - ADR 0035 (DataProvenance), ADR 0050 (Tenant Quota & Kill Switch), ADR 0052 (Economic Architecture).
 * - Strict seed mode enforcement: zero network calls without explicit developer authorization.
 * - Retains estimate, MOE, geography, vintage, and statutory foreign-born definitions (B05002).
 * - High performance: in-memory indexed queries < 10ms p95.
 */
export class CensusAcsAdapter {
  readonly clock: SimClock;
  private readonly fixturePath: string;
  private readonly enabled: boolean;
  private readonly seedMode: boolean;
  private readonly allowLiveCalls: boolean;
  private cachedDataset: EconomicFixtureDataset | null = null;
  private recordsByGeoKey: Map<string, EconomicEvidenceRecord[]> = new Map();

  constructor(options: CensusAcsAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.fixturePath = options.fixturePath ?? resolveFixturePath('census-acs-synthetic-v1.json');
    this.enabled = options.enabled ?? process.env.GEV_CENSUS_ACS_ENABLED !== '0';
    this.seedMode = options.seedMode ?? process.env.GEV_SEED_MODE !== '0';
    this.allowLiveCalls = options.allowLiveCalls ?? false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isSeedMode(): boolean {
    return this.seedMode;
  }

  getVariableDictionary(): CensusAcsVariableDictionary {
    return CENSUS_ACS_VARIABLE_DICTIONARY_V1;
  }

  /**
   * Loads and validates the Census ACS synthetic fixture dataset.
   * Indexes records in memory for high-performance sub-10ms queries.
   */
  loadDataset(): EconomicFixtureDataset {
    if (this.cachedDataset) {
      return this.cachedDataset;
    }

    if (!fs.existsSync(this.fixturePath)) {
      throw new Error(`Census ACS seed fixture not found at path '${this.fixturePath}'`);
    }

    const raw = fs.readFileSync(this.fixturePath, 'utf8');
    const parsed = JSON.parse(raw);
    const validated = EconomicFixtureDatasetSchema.parse(parsed);

    // Index records by geography key
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

  /**
   * Queries Census ACS evidence records for the given query.
   * Fails closed on malformed FIPS codes, invalid vintages, or unauthorized live calls.
   */
  async query(queryInput: CensusAcsQuery): Promise<readonly EconomicEvidenceRecord[]> {
    if (!this.enabled) {
      throw new CensusAcsProviderDisabledError();
    }

    // Contract validation
    const query = CensusAcsQuerySchema.parse(queryInput);

    // Fail closed on geographic rule violations (e.g. malformed FIPS or state mismatch)
    validateAcsGeography(query.geography);

    // Validate vintage if provided
    if (query.vintage) {
      const dictionary = this.getVariableDictionary();
      const isVintageSupported = dictionary.vintages_supported.some(
        (v) => query.vintage === v || Boolean(query.vintage?.startsWith(v))
      );
      if (!isVintageSupported) {
        throw new CensusAcsInvalidQueryError(
          `Census ACS unsupported vintage: '${query.vintage}'. Supported vintages: ${dictionary.vintages_supported.join(', ')}`
        );
      }
    }

    // Seed mode enforcement
    if (this.seedMode) {
      this.loadDataset();
      const geoKey = getGeographyKey(query.geography);
      const candidates = this.recordsByGeoKey.get(geoKey) ?? [];

      // Resolve requested variable IDs and metric IDs
      const requestedIds = new Set<string>();
      for (const varId of query.variables) {
        const resolved = lookupAcsVariable(varId);
        if (resolved) {
          requestedIds.add(resolved.variable_id);
          requestedIds.add(resolved.metric_id);
        } else {
          requestedIds.add(varId);
        }
      }

      // Filter matching records
      const matches = candidates.filter(
        (r) => requestedIds.has(r.variable_name) || requestedIds.has(r.metric_id)
      );

      return matches;
    }

    // Live mode check
    if (!this.allowLiveCalls) {
      throw new CensusAcsSeedModeViolationError(
        'Live Census API requests require explicit developer authorization. Out of scope for Task 9.1.'
      );
    }

    throw new Error('Live Census API path requires explicit developer authorization');
  }

  /**
   * Retrieves all available Census ACS evidence records for a geography.
   */
  async getEvidenceByGeography(
    geography: EconomicGeography
  ): Promise<readonly EconomicEvidenceRecord[]> {
    if (!this.enabled) {
      throw new CensusAcsProviderDisabledError();
    }

    validateAcsGeography(geography);
    this.loadDataset();
    const geoKey = getGeographyKey(geography);
    return this.recordsByGeoKey.get(geoKey) ?? [];
  }

  /**
   * Specifically queries and returns foreign-born population evidence (Table B05002) for a geography,
   * verifying that the statutory Census definition (both naturalized citizens and non-citizens) is preserved.
   */
  async getForeignBornPopulation(
    geography: EconomicGeography
  ): Promise<EconomicEvidenceRecord | undefined> {
    const records = await this.query({
      geography,
      variables: ['B05002_003E'],
    });

    const record = records.find(
      (r) => r.variable_name === 'B05002_003E' || r.metric_id === 'foreign-born-population'
    );

    if (record) {
      // Validate statutory definition in record notes/label
      const notes = record.estimate.status === 'available' ? (record.estimate.notes ?? '') : '';
      const noteOrLabel = `${record.label} ${notes}`.toLowerCase();
      if (!noteOrLabel.includes('naturalized') || !noteOrLabel.includes('non-citizen')) {
        throw new Error(
          `Foreign-born record '${record.evidence_id}' fails statutory definition requirement: must preserve both naturalized citizens and non-citizens`
        );
      }
    }

    return record;
  }
}
