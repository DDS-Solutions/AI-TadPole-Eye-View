import fs from 'node:fs';
import {
  BLS_API_LIMITS_REGISTERED,
  BLS_API_LIMITS_UNREGISTERED,
  BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER,
  type BlsOewsQuery,
  BlsOewsQuerySchema,
  type BlsOewsVariableDictionary,
  type EconomicEvidenceRecord,
  type EconomicFixtureDataset,
  EconomicFixtureDatasetSchema,
  type EconomicGeography,
  PROHIBITED_WORKER_PII_FIELDS,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  BLS_OEWS_VARIABLE_DICTIONARY_V1,
  lookupOewsVariable,
  validateOewsGeography,
  validateOewsSocCode,
} from '@gev/economic';
import { resolveFixturePath } from './opensky.js';

export const BLS_OEWS_PROVIDER_ID = 'bls-oews' as const;
export const BLS_OEWS_FEED_ID = 'oews-annual' as const;
export const BLS_OEWS_SEED_FIXTURE_ID = 'bls-oews-synthetic-v1' as const;

export class BlsOewsProviderDisabledError extends Error {
  constructor() {
    super('BLS OEWS provider is disabled by the GEV_BLS_OEWS_ENABLED kill switch');
    this.name = 'BlsOewsProviderDisabledError';
  }
}

export class BlsOewsSeedModeViolationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Live BLS OEWS API requests require explicit developer authorization and are prohibited in seed mode (PLAN.md §2 Principle 4 & §10 Task 10.1)'
    );
    this.name = 'BlsOewsSeedModeViolationError';
  }
}

export class BlsOewsInvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlsOewsInvalidQueryError';
  }
}

export class BlsPiiIngestionError extends Error {
  constructor(field: string) {
    super(
      `Prohibited employee/applicant PII field '${field}' detected. BLS workforce ingestion strictly prohibits worker PII.`
    );
    this.name = 'BlsPiiIngestionError';
  }
}

export class BlsRateLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlsRateLimitExceededError';
  }
}

export interface BlsOewsAdapterOptions {
  clock?: SimClock;
  fixturePath?: string;
  enabled?: boolean;
  seedMode?: boolean;
  allowLiveCalls?: boolean;
  apiKey?: string;
  isRegistered?: boolean;
}

/**
 * Extracts a normalized matching key for an EconomicGeography to enable O(1) index lookups.
 */
function getGeographyKey(geo: EconomicGeography): string {
  switch (geo.level) {
    case 'cbsa':
      return `cbsa:${geo.cbsa_code}`;
    case 'state':
      return `state:${geo.state_fips}`;
    case 'county':
      return `county:${geo.county_fips}`;
    case 'nation':
      return `nation:${geo.country_code}`;
    default:
      return `${(geo as { level: string }).level}:unknown`;
  }
}

/**
 * Extracts the 6-digit SOC code (format XX-XXXX) from an evidence record's tags, evidence ID, or variable name.
 */
function getRecordSocCode(record: EconomicEvidenceRecord): string | undefined {
  const socTag = record.tags?.find((t) => t.startsWith('soc-'));
  if (socTag) {
    const rawCode = socTag.slice(4);
    if (rawCode.length === 6 && !rawCode.includes('-')) {
      return `${rawCode.slice(0, 2)}-${rawCode.slice(2)}`;
    }
    return rawCode;
  }
  const match = record.evidence_id.match(/-([0-9]{2})([0-9]{4})-/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return undefined;
}

/**
 * Verifies that an arbitrary input payload does not contain prohibited employee/applicant PII.
 */
function assertNoPii(input: unknown): void {
  if (typeof input !== 'object' || input === null) {
    return;
  }
  const rawObj = input as Record<string, unknown>;
  for (const key of Object.keys(rawObj)) {
    const lowerKey = key.toLowerCase();
    if (PROHIBITED_WORKER_PII_FIELDS.some((pii) => lowerKey === pii || lowerKey.includes(pii))) {
      throw new BlsPiiIngestionError(key);
    }
  }
}

/**
 * BLS Occupational Employment and Wage Statistics (OEWS) Provider Adapter.
 * Adheres strictly to:
 * - PLAN.md §2 Principle 1 (Boundaries are law) & §8.2, §10.1 (Economic R2).
 * - ADR 0035 (DataProvenance), ADR 0050 (Tenant Quota & Kill Switch), ADR 0052 (Economic Architecture).
 * - Strict seed mode enforcement: zero external network calls without explicit developer authorization.
 * - Zero numeric zero-coercion: preserves top-coded wage suppression and data quality suppression.
 * - Anti-PII verification: strictly rejects any individual worker/applicant personal data.
 * - Registered vs unregistered request limit enforcement (BLS API v2 limits: 10 vs 50 series per query).
 * - High performance: in-memory indexed queries < 10ms p95.
 */
export class BlsOewsAdapter {
  readonly clock: SimClock;
  private readonly fixturePath: string;
  private readonly enabled: boolean;
  private readonly seedMode: boolean;
  private readonly allowLiveCalls: boolean;
  private readonly apiKey?: string;
  private readonly isRegistered: boolean;
  private cachedDataset: EconomicFixtureDataset | null = null;
  private recordsByGeoKey: Map<string, EconomicEvidenceRecord[]> = new Map();

  constructor(options: BlsOewsAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.fixturePath = options.fixturePath ?? resolveFixturePath('bls-oews-synthetic-v1.json');
    this.enabled = options.enabled ?? process.env.GEV_BLS_OEWS_ENABLED !== '0';
    this.seedMode = options.seedMode ?? process.env.GEV_SEED_MODE !== '0';
    this.allowLiveCalls = options.allowLiveCalls ?? false;
    this.apiKey = options.apiKey ?? process.env.BLS_API_KEY;
    this.isRegistered = options.isRegistered ?? Boolean(this.apiKey);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isSeedMode(): boolean {
    return this.seedMode;
  }

  getAnnualDisclaimer(): string {
    return BLS_OEWS_ANNUAL_STATISTICAL_DISCLAIMER;
  }

  getVariableDictionary(): BlsOewsVariableDictionary {
    return BLS_OEWS_VARIABLE_DICTIONARY_V1;
  }

  /**
   * Loads and validates the BLS OEWS synthetic fixture dataset.
   * Indexes records in memory for high-performance sub-10ms queries.
   */
  loadDataset(): EconomicFixtureDataset {
    if (this.cachedDataset) {
      return this.cachedDataset;
    }

    if (!fs.existsSync(this.fixturePath)) {
      throw new Error(`BLS OEWS seed fixture not found at path '${this.fixturePath}'`);
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
   * Queries BLS OEWS evidence records.
   * Fails closed on malformed CBSA/FIPS/SOC codes, rate-limit breaches, or worker PII.
   */
  async query(queryInput: BlsOewsQuery): Promise<readonly EconomicEvidenceRecord[]> {
    if (!this.enabled) {
      throw new BlsOewsProviderDisabledError();
    }

    // Anti-PII verification
    assertNoPii(queryInput);

    // Contract validation
    const query = BlsOewsQuerySchema.parse(queryInput);

    // Geographic boundary validation
    validateOewsGeography(query.geography);

    // SOC code format validation
    if (query.soc_code) {
      validateOewsSocCode(query.soc_code);
    }

    // Rate-limit check
    const isRegistered = query.is_registered ?? this.isRegistered;
    const maxVars = isRegistered
      ? BLS_API_LIMITS_REGISTERED.max_series_per_query
      : BLS_API_LIMITS_UNREGISTERED.max_series_per_query;
    if (query.variables && query.variables.length > maxVars) {
      throw new BlsRateLimitExceededError(
        `Requested ${query.variables.length} series exceeds BLS API limit of ${maxVars} for ${isRegistered ? 'registered' : 'unregistered'} queries`
      );
    }

    // Seed mode execution
    if (this.seedMode) {
      this.loadDataset();
      const geoKey = getGeographyKey(query.geography);
      let candidates = this.recordsByGeoKey.get(geoKey) ?? [];

      // Filter by SOC code if specified
      if (query.soc_code) {
        const targetSoc = query.soc_code;
        const normalizedTarget = targetSoc.replace('-', '');
        candidates = candidates.filter((r) => {
          const recSoc = getRecordSocCode(r);
          if (!recSoc) return false;
          const normalizedRec = recSoc.replace('-', '');
          return (
            recSoc === targetSoc ||
            normalizedRec === normalizedTarget ||
            r.tags?.includes(`soc-${normalizedTarget}`) ||
            r.tags?.includes(`soc-${targetSoc}`)
          );
        });
      }

      // Filter by variables/metrics if specified
      if (query.variables && query.variables.length > 0) {
        const requestedIds = new Set<string>();
        for (const varId of query.variables) {
          const resolved = lookupOewsVariable(varId);
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
      throw new BlsOewsSeedModeViolationError(
        'Live BLS OEWS API requests require explicit developer authorization. Out of scope for Task 10.1.'
      );
    }

    throw new Error('Live BLS OEWS API path requires explicit developer authorization');
  }

  /**
   * Retrieves all available OEWS records for a geography.
   */
  async getEvidenceByGeography(
    geography: EconomicGeography
  ): Promise<readonly EconomicEvidenceRecord[]> {
    if (!this.enabled) {
      throw new BlsOewsProviderDisabledError();
    }
    validateOewsGeography(geography);
    this.loadDataset();
    const geoKey = getGeographyKey(geography);
    return this.recordsByGeoKey.get(geoKey) ?? [];
  }

  /**
   * Queries records for a specific SOC occupation code within a geography.
   */
  async getEvidenceBySoc(
    geography: EconomicGeography,
    socCode: string
  ): Promise<readonly EconomicEvidenceRecord[]> {
    return this.query({
      geography,
      soc_code: socCode,
    });
  }

  /**
   * Convenience query for annual and hourly median wage records (A_MEDIAN, H_MEDIAN).
   */
  async getMedianWages(
    geography: EconomicGeography,
    socCode?: string
  ): Promise<readonly EconomicEvidenceRecord[]> {
    return this.query({
      geography,
      soc_code: socCode,
      variables: ['A_MEDIAN', 'H_MEDIAN'],
    });
  }

  /**
   * Convenience query for annual and hourly mean wage records (A_MEAN, H_MEAN).
   */
  async getMeanWages(
    geography: EconomicGeography,
    socCode?: string
  ): Promise<readonly EconomicEvidenceRecord[]> {
    return this.query({
      geography,
      soc_code: socCode,
      variables: ['A_MEAN', 'H_MEAN'],
    });
  }

  /**
   * Convenience query for occupational employment headcount (TOT_EMP).
   */
  async getEmployment(
    geography: EconomicGeography,
    socCode?: string
  ): Promise<readonly EconomicEvidenceRecord[]> {
    return this.query({
      geography,
      soc_code: socCode,
      variables: ['TOT_EMP'],
    });
  }

  /**
   * Queries the full percentile wage distribution for an occupation (10th, 25th, 50th, 75th, 90th).
   */
  async getWageDistribution(
    geography: EconomicGeography,
    socCode: string
  ): Promise<Record<string, EconomicEvidenceRecord | undefined>> {
    const records = await this.query({
      geography,
      soc_code: socCode,
      variables: [
        'A_PCT10',
        'A_PCT25',
        'A_MEDIAN',
        'A_PCT75',
        'A_PCT90',
        'H_PCT10',
        'H_PCT25',
        'H_MEDIAN',
        'H_PCT75',
        'H_PCT90',
      ],
    });

    const dist: Record<string, EconomicEvidenceRecord | undefined> = {};
    for (const r of records) {
      dist[r.variable_name] = r;
    }
    return dist;
  }
}
