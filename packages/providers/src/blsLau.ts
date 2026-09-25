import fs from 'node:fs';
import {
  BLS_API_LIMITS_REGISTERED,
  BLS_API_LIMITS_UNREGISTERED,
  BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER,
  type BlsLauQuery,
  BlsLauQuerySchema,
  type BlsLauVariableDictionary,
  type EconomicEvidenceRecord,
  type EconomicFixtureDataset,
  EconomicFixtureDatasetSchema,
  type EconomicGeography,
  PROHIBITED_WORKER_PII_FIELDS,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  BLS_LAU_VARIABLE_DICTIONARY_V1,
  lookupLauVariable,
  validateLauGeography,
} from '@gev/economic';
import { resolveFixturePath } from './opensky.js';

export const BLS_LAU_PROVIDER_ID = 'bls-lau' as const;
export const BLS_LAU_FEED_ID = 'lau-monthly' as const;
export const BLS_LAU_SEED_FIXTURE_ID = 'bls-lau-synthetic-v1' as const;

export class BlsLauProviderDisabledError extends Error {
  constructor() {
    super('BLS LAU provider is disabled by the GEV_BLS_LAU_ENABLED kill switch');
    this.name = 'BlsLauProviderDisabledError';
  }
}

export class BlsLauSeedModeViolationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Live BLS LAU API requests require explicit developer authorization and are prohibited in seed mode (PLAN.md §2 Principle 4 & §10 Task 10.1)'
    );
    this.name = 'BlsLauSeedModeViolationError';
  }
}

export class BlsLauInvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlsLauInvalidQueryError';
  }
}

export class BlsLauPiiIngestionError extends Error {
  constructor(field: string) {
    super(
      `Prohibited employee/applicant PII field '${field}' detected. BLS workforce ingestion strictly prohibits worker PII.`
    );
    this.name = 'BlsLauPiiIngestionError';
  }
}

export class BlsLauRateLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlsLauRateLimitExceededError';
  }
}

export interface BlsLauAdapterOptions {
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
    case 'county':
      return `county:${geo.county_fips}`;
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
      throw new BlsLauPiiIngestionError(key);
    }
  }
}

/**
 * BLS Local Area Unemployment Statistics (LAU) Provider Adapter.
 * Adheres strictly to:
 * - PLAN.md §2 Principle 1 (Boundaries are law) & §8.2, §10.1 (Economic R2).
 * - ADR 0035 (DataProvenance), ADR 0050 (Tenant Quota & Kill Switch), ADR 0052 (Economic Architecture).
 * - Strict seed mode enforcement: zero external network calls without explicit developer authorization.
 * - Zero numeric zero-coercion: preserves resident labor force, employment, and unemployment rates.
 * - Anti-PII verification: strictly rejects any individual worker/applicant personal data.
 * - Registered vs unregistered request limit enforcement (BLS API v2 limits: 10 vs 50 series per query).
 * - High performance: in-memory indexed queries < 10ms p95.
 */
export class BlsLauAdapter {
  readonly clock: SimClock;
  private readonly fixturePath: string;
  private readonly enabled: boolean;
  private readonly seedMode: boolean;
  private readonly allowLiveCalls: boolean;
  private readonly apiKey?: string;
  private readonly isRegistered: boolean;
  private cachedDataset: EconomicFixtureDataset | null = null;
  private recordsByGeoKey: Map<string, EconomicEvidenceRecord[]> = new Map();

  constructor(options: BlsLauAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.fixturePath = options.fixturePath ?? resolveFixturePath('bls-lau-synthetic-v1.json');
    this.enabled = options.enabled ?? process.env.GEV_BLS_LAU_ENABLED !== '0';
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

  getMonthlyDisclaimer(): string {
    return BLS_LAU_MONTHLY_STATISTICAL_DISCLAIMER;
  }

  getVariableDictionary(): BlsLauVariableDictionary {
    return BLS_LAU_VARIABLE_DICTIONARY_V1;
  }

  /**
   * Loads and validates the BLS LAU synthetic fixture dataset.
   * Indexes records in memory for high-performance sub-10ms queries.
   */
  loadDataset(): EconomicFixtureDataset {
    if (this.cachedDataset) {
      return this.cachedDataset;
    }

    if (!fs.existsSync(this.fixturePath)) {
      throw new Error(`BLS LAU seed fixture not found at path '${this.fixturePath}'`);
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
   * Queries BLS LAU evidence records.
   * Fails closed on malformed FIPS/CBSA codes, rate-limit breaches, or worker PII.
   */
  async query(queryInput: BlsLauQuery): Promise<readonly EconomicEvidenceRecord[]> {
    if (!this.enabled) {
      throw new BlsLauProviderDisabledError();
    }

    // Anti-PII verification
    assertNoPii(queryInput);

    // Contract validation
    const query = BlsLauQuerySchema.parse(queryInput);

    // Geographic boundary validation
    validateLauGeography(query.geography);

    // Rate-limit check
    const isRegistered = query.is_registered ?? this.isRegistered;
    const maxVars = isRegistered
      ? BLS_API_LIMITS_REGISTERED.max_series_per_query
      : BLS_API_LIMITS_UNREGISTERED.max_series_per_query;
    const requestedCount = (query.variables?.length ?? 0) + (query.measures?.length ?? 0);
    if (requestedCount > maxVars) {
      throw new BlsLauRateLimitExceededError(
        `Requested ${requestedCount} series/measures exceeds BLS API limit of ${maxVars} for ${isRegistered ? 'registered' : 'unregistered'} queries`
      );
    }

    // Seed mode execution
    if (this.seedMode) {
      this.loadDataset();
      const geoKey = getGeographyKey(query.geography);
      let candidates = this.recordsByGeoKey.get(geoKey) ?? [];

      // Filter by period (e.g. M07 -> 2026-07 or July) if specified
      if (query.period) {
        const periodNum = query.period.slice(1); // '07'
        candidates = candidates.filter((r) => {
          const obsStart =
            r.provenance.observation_period?.status === 'available'
              ? r.provenance.observation_period.start
              : '';
          const vintageVal =
            r.provenance.vintage.status === 'available' ? r.provenance.vintage.value : '';
          return (
            obsStart.includes(`-${periodNum}-`) ||
            vintageVal.includes(query.period!) ||
            r.evidence_id.includes(periodNum)
          );
        });
      }

      // Filter by year if specified
      if (query.year) {
        candidates = candidates.filter((r) => {
          const obsStart =
            r.provenance.observation_period?.status === 'available'
              ? r.provenance.observation_period.start
              : '';
          const vintageVal =
            r.provenance.vintage.status === 'available' ? r.provenance.vintage.value : '';
          return (
            obsStart.startsWith(query.year!) ||
            vintageVal.includes(query.year!) ||
            r.evidence_id.includes(query.year!)
          );
        });
      }

      // Filter by measures or variables if specified
      const hasFilter =
        (query.measures && query.measures.length > 0) ||
        (query.variables && query.variables.length > 0);

      if (hasFilter) {
        const requestedIds = new Set<string>();
        if (query.variables) {
          for (const varId of query.variables) {
            const resolved = lookupLauVariable(varId);
            if (resolved) {
              requestedIds.add(resolved.variable_id);
              requestedIds.add(resolved.metric_id);
              requestedIds.add(resolved.measure_code);
            } else {
              requestedIds.add(varId);
            }
          }
        }
        if (query.measures) {
          for (const m of query.measures) {
            const resolved = lookupLauVariable(m);
            if (resolved) {
              requestedIds.add(resolved.variable_id);
              requestedIds.add(resolved.metric_id);
              requestedIds.add(resolved.measure_code);
            } else {
              requestedIds.add(m);
            }
          }
        }

        candidates = candidates.filter(
          (r) =>
            requestedIds.has(r.variable_name) ||
            requestedIds.has(r.metric_id) ||
            r.tags?.some((t) => requestedIds.has(t))
        );
      }

      return candidates;
    }

    // Live mode check
    if (!this.allowLiveCalls) {
      throw new BlsLauSeedModeViolationError(
        'Live BLS LAU API requests require explicit developer authorization. Out of scope for Task 10.1.'
      );
    }

    throw new Error('Live BLS LAU API path requires explicit developer authorization');
  }

  /**
   * Retrieves all available LAU records for a geography.
   */
  async getEvidenceByGeography(
    geography: EconomicGeography
  ): Promise<readonly EconomicEvidenceRecord[]> {
    if (!this.enabled) {
      throw new BlsLauProviderDisabledError();
    }
    validateLauGeography(geography);
    this.loadDataset();
    const geoKey = getGeographyKey(geography);
    return this.recordsByGeoKey.get(geoKey) ?? [];
  }

  /**
   * Convenience query for the unemployment rate record.
   */
  async getUnemploymentRate(
    geography: EconomicGeography,
    period?: string
  ): Promise<EconomicEvidenceRecord | undefined> {
    const records = await this.query({
      geography,
      measures: ['03'],
      period,
    });
    return records.find(
      (r) => r.metric_id === 'unemployment-rate' || r.variable_name === 'LAU_RATE'
    );
  }

  /**
   * Convenience query for civilian labor force headcount.
   */
  async getLaborForce(
    geography: EconomicGeography,
    period?: string
  ): Promise<EconomicEvidenceRecord | undefined> {
    const records = await this.query({
      geography,
      measures: ['06'],
      period,
    });
    return records.find(
      (r) => r.metric_id === 'civilian-labor-force' || r.variable_name === 'LAU_LABOR_FORCE'
    );
  }

  /**
   * Convenience query for total employed residents headcount.
   */
  async getEmployment(
    geography: EconomicGeography,
    period?: string
  ): Promise<EconomicEvidenceRecord | undefined> {
    const records = await this.query({
      geography,
      measures: ['05'],
      period,
    });
    return records.find(
      (r) => r.metric_id === 'employed-count' || r.variable_name === 'LAU_EMPLOYED'
    );
  }

  /**
   * Convenience query for total unemployed residents headcount.
   */
  async getUnemployment(
    geography: EconomicGeography,
    period?: string
  ): Promise<EconomicEvidenceRecord | undefined> {
    const records = await this.query({
      geography,
      measures: ['04'],
      period,
    });
    return records.find(
      (r) => r.metric_id === 'unemployed-count' || r.variable_name === 'LAU_UNEMPLOYED'
    );
  }

  /**
   * Bundles all 4 monthly measures for an area into a structured summary.
   */
  async getMonthlySummary(
    geography: EconomicGeography,
    period?: string
  ): Promise<{
    rate?: EconomicEvidenceRecord;
    labor_force?: EconomicEvidenceRecord;
    employed?: EconomicEvidenceRecord;
    unemployed?: EconomicEvidenceRecord;
  }> {
    const records = await this.query({
      geography,
      period,
    });

    return {
      rate: records.find(
        (r) => r.metric_id === 'unemployment-rate' || r.variable_name === 'LAU_RATE'
      ),
      labor_force: records.find(
        (r) => r.metric_id === 'civilian-labor-force' || r.variable_name === 'LAU_LABOR_FORCE'
      ),
      employed: records.find(
        (r) => r.metric_id === 'employed-count' || r.variable_name === 'LAU_EMPLOYED'
      ),
      unemployed: records.find(
        (r) => r.metric_id === 'unemployed-count' || r.variable_name === 'LAU_UNEMPLOYED'
      ),
    };
  }
}
