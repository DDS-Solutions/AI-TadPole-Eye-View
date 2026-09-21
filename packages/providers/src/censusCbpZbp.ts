import fs from 'node:fs';
import {
  CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER,
  type CensusCbpQuery,
  CensusCbpQuerySchema,
  type CensusCbpVariableDictionary,
  type EconomicEvidenceRecord,
  type EconomicFixtureDataset,
  EconomicFixtureDatasetSchema,
  type EconomicGeography,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  CENSUS_CBP_VARIABLE_DICTIONARY_V1,
  lookupCbpVariable,
  validateCbpGeography,
  validateCbpNaicsCode,
} from '@gev/economic';
import { resolveFixturePath } from './opensky.js';

export const CENSUS_CBP_PROVIDER_ID = 'census-cbp-zbp' as const;
export const CENSUS_CBP_FEED_ID = 'cbp-zbp-annual' as const;
export const CENSUS_CBP_SEED_FIXTURE_ID = 'census-cbp-zbp-synthetic-v1' as const;

export class CensusCbpProviderDisabledError extends Error {
  constructor() {
    super('Census CBP/ZBP provider is disabled by the GEV_CENSUS_CBP_ENABLED kill switch');
    this.name = 'CensusCbpProviderDisabledError';
  }
}

export class CensusCbpSeedModeViolationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Live Census API requests require explicit developer authorization and are prohibited in seed mode (PLAN.md §2 Principle 4 & §10 Task 9.2)'
    );
    this.name = 'CensusCbpSeedModeViolationError';
  }
}

export class CensusCbpInvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CensusCbpInvalidQueryError';
  }
}

export interface CensusCbpAdapterOptions {
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
    case 'zcta':
      return `zcta:${geo.zcta}`;
    case 'cbsa':
      return `cbsa:${geo.cbsa_code}`;
    case 'state':
      return `state:${geo.state_fips}`;
    case 'nation':
      return `nation:${geo.country_code}`;
    default:
      return `${(geo as { level: string }).level}:unknown`;
  }
}

/**
 * Extracts the NAICS code from an evidence record's tags or evidence ID.
 */
function getRecordNaicsCode(record: EconomicEvidenceRecord): string | undefined {
  const naicsTag = record.tags?.find((t) => t.startsWith('naics-'));
  if (naicsTag) {
    return naicsTag.slice(6);
  }
  const match = record.evidence_id.match(/-(?:cbp|zbp)-([0-9]{2,6})-/);
  if (match) {
    return match[1];
  }
  return undefined;
}

/**
 * Census CBP & ZBP Provider Adapter.
 * Adheres strictly to:
 * - PLAN.md §2 Principle 1 (Boundaries are law) & §8.2, §9.2 (Economic R1).
 * - ADR 0035 (DataProvenance), ADR 0050 (Tenant Quota & Kill Switch), ADR 0052 (Economic Architecture).
 * - Strict seed mode enforcement: zero network calls without explicit developer authorization.
 * - Preserves statutory disclosure avoidance suppression under 13 U.S.C. Section 9 (with noise bounds/flags).
 * - Retains establishment counts, paid employment, annual payroll, and first-quarter payroll.
 * - Enforces annual-statistical-estimate disclaimer.
 * - High performance: in-memory indexed queries < 10ms p95.
 */
export class CensusCbpZbpAdapter {
  readonly clock: SimClock;
  private readonly fixturePath: string;
  private readonly enabled: boolean;
  private readonly seedMode: boolean;
  private readonly allowLiveCalls: boolean;
  private cachedDataset: EconomicFixtureDataset | null = null;
  private recordsByGeoKey: Map<string, EconomicEvidenceRecord[]> = new Map();

  constructor(options: CensusCbpAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.fixturePath =
      options.fixturePath ?? resolveFixturePath('census-cbp-zbp-synthetic-v1.json');
    this.enabled = options.enabled ?? process.env.GEV_CENSUS_CBP_ENABLED !== '0';
    this.seedMode = options.seedMode ?? process.env.GEV_SEED_MODE !== '0';
    this.allowLiveCalls = options.allowLiveCalls ?? false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isSeedMode(): boolean {
    return this.seedMode;
  }

  getAnnualDisclaimer(): string {
    return CENSUS_CBP_ANNUAL_STATISTICAL_DISCLAIMER;
  }

  getVariableDictionary(): CensusCbpVariableDictionary {
    return CENSUS_CBP_VARIABLE_DICTIONARY_V1;
  }

  /**
   * Loads and validates the Census CBP/ZBP synthetic fixture dataset.
   * Indexes records in memory for high-performance sub-10ms queries.
   */
  loadDataset(): EconomicFixtureDataset {
    if (this.cachedDataset) {
      return this.cachedDataset;
    }

    if (!fs.existsSync(this.fixturePath)) {
      throw new Error(`Census CBP/ZBP seed fixture not found at path '${this.fixturePath}'`);
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
   * Queries Census CBP/ZBP evidence records.
   * Fails closed on malformed FIPS/NAICS codes, invalid vintages, or unauthorized live calls.
   */
  async query(queryInput: CensusCbpQuery): Promise<readonly EconomicEvidenceRecord[]> {
    if (!this.enabled) {
      throw new CensusCbpProviderDisabledError();
    }

    // Contract validation
    const query = CensusCbpQuerySchema.parse(queryInput);

    // Fail closed on geographic rule violations (e.g. malformed FIPS or state mismatch)
    validateCbpGeography(query.geography);

    // Fail closed on invalid NAICS code if provided
    if (query.naics_code) {
      validateCbpNaicsCode(query.naics_code);
    }

    // Validate vintage if provided
    if (query.vintage) {
      const dictionary = this.getVariableDictionary();
      const isVintageSupported = dictionary.vintages_supported.some(
        (v) => query.vintage === v || Boolean(query.vintage?.startsWith(v))
      );
      if (!isVintageSupported) {
        throw new CensusCbpInvalidQueryError(
          `Census CBP/ZBP unsupported vintage: '${query.vintage}'. Supported vintages: ${dictionary.vintages_supported.join(', ')}`
        );
      }
    }

    // Seed mode enforcement
    if (this.seedMode) {
      this.loadDataset();
      const geoKey = getGeographyKey(query.geography);
      let candidates = this.recordsByGeoKey.get(geoKey) ?? [];

      // Filter by NAICS code if requested
      if (query.naics_code) {
        const targetNaics = query.naics_code;
        candidates = candidates.filter((r) => {
          const recNaics = getRecordNaicsCode(r);
          return recNaics
            ? recNaics.startsWith(targetNaics) || targetNaics.startsWith(recNaics)
            : false;
        });
      }

      // Filter by variables if requested
      if (query.variables && query.variables.length > 0) {
        const requestedIds = new Set<string>();
        for (const varId of query.variables) {
          const resolved = lookupCbpVariable(varId);
          if (resolved) {
            requestedIds.add(resolved.variable_id);
            requestedIds.add(resolved.metric_id);
          } else {
            requestedIds.add(varId);
          }
        }

        candidates = candidates.filter(
          (r) => requestedIds.has(r.variable_name) || requestedIds.has(r.metric_id)
        );
      }

      return candidates;
    }

    // Live mode check
    if (!this.allowLiveCalls) {
      throw new CensusCbpSeedModeViolationError(
        'Live Census API requests require explicit developer authorization. Out of scope for Task 9.2.'
      );
    }

    throw new Error('Live Census CBP API path requires explicit developer authorization');
  }

  /**
   * Retrieves all available Census CBP/ZBP evidence records for a geography.
   */
  async getEvidenceByGeography(
    geography: EconomicGeography
  ): Promise<readonly EconomicEvidenceRecord[]> {
    if (!this.enabled) {
      throw new CensusCbpProviderDisabledError();
    }

    validateCbpGeography(geography);
    this.loadDataset();
    const geoKey = getGeographyKey(geography);
    return this.recordsByGeoKey.get(geoKey) ?? [];
  }

  /**
   * Specifically queries records for a specific NAICS industry code within a geography.
   */
  async getEvidenceByNaics(
    geography: EconomicGeography,
    naicsCode: string
  ): Promise<readonly EconomicEvidenceRecord[]> {
    return this.query({
      geography,
      naics_code: naicsCode,
    });
  }

  /**
   * Convenience query for establishment count records (ESTAB).
   */
  async getEstablishments(
    geography: EconomicGeography,
    naicsCode?: string
  ): Promise<readonly EconomicEvidenceRecord[]> {
    return this.query({
      geography,
      naics_code: naicsCode,
      variables: ['ESTAB'],
    });
  }

  /**
   * Convenience query for paid employment records (EMP), preserving statutory disclosure avoidance suppression.
   */
  async getPaidEmployment(
    geography: EconomicGeography,
    naicsCode?: string
  ): Promise<readonly EconomicEvidenceRecord[]> {
    return this.query({
      geography,
      naics_code: naicsCode,
      variables: ['EMP'],
    });
  }

  /**
   * Convenience query for annual and first-quarter payroll records (PAYANN, PAYQTR1).
   */
  async getPayroll(
    geography: EconomicGeography,
    naicsCode?: string
  ): Promise<readonly EconomicEvidenceRecord[]> {
    return this.query({
      geography,
      naics_code: naicsCode,
      variables: ['PAYANN', 'PAYQTR1'],
    });
  }
}
