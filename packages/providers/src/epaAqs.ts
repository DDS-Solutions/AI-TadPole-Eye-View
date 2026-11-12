import fs from 'node:fs';
import {
  type DataProvenance,
  EPA_AQS_BASE_URL,
  EPA_AQS_CRITERIA_POLLUTANTS,
  EPA_AQS_DATA_CLASSIFICATION,
  EPA_AQS_DEFAULT_VINTAGE,
  EPA_AQS_HISTORICAL_DISCLAIMER,
  EPA_AQS_PROHIBITED_REALTIME_HOST,
  type EconomicGeography,
  type EpaAqsFixtureDataset,
  EpaAqsFixtureDatasetSchema,
  type EpaAqsMonitoringSite,
  type EpaAqsPollutantSymbol,
  type EpaAqsQuarter,
  type EpaAqsQuery,
  type EpaAqsQueryResult,
  EpaAqsQueryResultSchema,
  EpaAqsQuerySchema,
  type EpaAqsSummaryPeriod,
  type EpaAqsSummaryRecord,
  type ParsedEpaAqsQuery,
  RawEpaAqsSummaryResponseSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  EPA_AQS_PARAMETERS_V1,
  createUnmonitoredEpaAqsSummary,
  getEpaAqsParameterCode,
  matchesSiteGeography,
  summarizeEpaAqsPollutantCoverage,
  validateEpaAqsEndpoint,
  validateEpaAqsGeography,
} from '@gev/economic';
import { type PinnedFetchOptions, pinnedFetch } from '@gev/security';
import {
  applyGeographyParams,
  buildLiveSummaryPath,
  formatAqsDate,
  normalizeLiveSummaryRow,
} from './epaAqsWire.js';
import { resolveFixturePath } from './opensky.js';

export const EPA_AQS_PROVIDER_ID = 'epa-aqs' as const;
export const EPA_AQS_FEED_ID = 'historical-monitoring' as const;
export const EPA_AQS_SEED_FIXTURE_ID = 'epa-aqs-synthetic-v1' as const;

export class EpaAqsDisabledError extends Error {
  constructor() {
    super('EPA AQS provider is disabled by the GEV_EPA_AQS_ENABLED kill switch');
    this.name = 'EpaAqsDisabledError';
  }
}

export class EpaAqsSeedModeViolationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Live EPA AQS API requests require explicit developer authorization and are prohibited in seed mode (PLAN.md §2 Principle 4 & §10 Task 11.3)'
    );
    this.name = 'EpaAqsSeedModeViolationError';
  }
}

export class EpaAqsAirNowScopeError extends Error {
  constructor(endpointUrl: string) {
    super(
      `AirNow real-time AQI endpoint (${endpointUrl}) is prohibited in EPA AQS adapter. EPA AQS provides historical/regulatory monitoring data only (PLAN.md §10 Task 11.3).`
    );
    this.name = 'EpaAqsAirNowScopeError';
  }
}

export class EpaAqsCredentialsMissingError extends Error {
  constructor() {
    super(
      'Live EPA AQS API requests require GEV_EPA_AQS_EMAIL and GEV_EPA_AQS_API_KEY credentials'
    );
    this.name = 'EpaAqsCredentialsMissingError';
  }
}

export interface EpaAqsAdapterOptions {
  clock?: SimClock;
  fixturePath?: string;
  enabled?: boolean;
  seedMode?: boolean;
  allowLiveCalls?: boolean;
  endpointUrl?: string;
  email?: string;
  apiKey?: string;
  pinnedFetchOptions?: Partial<PinnedFetchOptions>;
}

function createEpaAqsProvenance(clock: SimClock, mode: 'seed' | 'live'): DataProvenance {
  const nowIso = new Date(clock.now()).toISOString();
  return {
    schema_version: 1,
    source: {
      provider_id: EPA_AQS_PROVIDER_ID,
      feed_id: EPA_AQS_FEED_ID,
      name: 'U.S. EPA Air Quality System (AQS)',
      canonical_url: EPA_AQS_BASE_URL,
    },
    retrieved_at: nowIso,
    observation_period: {
      status: 'available',
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-12-31T23:59:59.000Z',
    },
    vintage: {
      status: 'available',
      value: EPA_AQS_DEFAULT_VINTAGE,
    },
    mode,
    source_mode: mode,
    license: {
      id: 'us-government-public-domain',
      name: 'U.S. Government Work - 17 U.S.C. 105 (Public Domain)',
    },
    attribution: 'U.S. Environmental Protection Agency, Air Quality System',
    fixture_id: mode === 'seed' ? EPA_AQS_SEED_FIXTURE_ID : null,
    cache: null,
    freshness: {
      status: 'fresh',
      age_seconds: 0,
      fresh_for_seconds: 2592000,
    },
  };
}

/**
 * EPA Air Quality System (AQS) Historical Regulatory Monitoring Adapter.
 * Implements PLAN.md §10 Task 11.3 and ADR 0064.
 * - Historical regulatory monitoring only (NEVER real-time AQI; AirNow prohibited).
 * - Zero coercion of unmonitored pollutants or missing observations to 0.0.
 * - Seed mode default (GEV_SEED_MODE=1) with zero live calls.
 * - Kill switch GEV_EPA_AQS_ENABLED fails closed.
 */
export class EpaAqsAdapter {
  readonly clock: SimClock;
  private readonly fixturePath: string;
  private readonly enabled: boolean;
  private readonly seedMode: boolean;
  private readonly allowLiveCalls: boolean;
  private readonly endpointUrl: string;
  private readonly email?: string;
  private readonly apiKey?: string;
  private readonly pinnedFetchOptions: Partial<PinnedFetchOptions>;
  private cachedFixture: EpaAqsFixtureDataset | null = null;

  constructor(options: EpaAqsAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.fixturePath = options.fixturePath ?? resolveFixturePath('epa-aqs-synthetic-v1.json');
    this.enabled = options.enabled ?? process.env.GEV_EPA_AQS_ENABLED !== '0';
    this.seedMode = options.seedMode ?? process.env.GEV_SEED_MODE !== '0';
    this.allowLiveCalls = options.allowLiveCalls ?? false;
    this.endpointUrl = options.endpointUrl ?? EPA_AQS_BASE_URL;
    this.email = options.email ?? process.env.GEV_EPA_AQS_EMAIL;
    this.apiKey = options.apiKey ?? process.env.GEV_EPA_AQS_API_KEY;
    this.pinnedFetchOptions = options.pinnedFetchOptions ?? {};

    const lowerUrl = this.endpointUrl.toLowerCase();
    if (lowerUrl.includes(EPA_AQS_PROHIBITED_REALTIME_HOST) || lowerUrl.includes('airnow')) {
      throw new EpaAqsAirNowScopeError(this.endpointUrl);
    }
    validateEpaAqsEndpoint(this.endpointUrl);
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

  getHistoricalDisclaimer(): string {
    return EPA_AQS_HISTORICAL_DISCLAIMER;
  }

  getParameterDictionary() {
    return EPA_AQS_PARAMETERS_V1;
  }

  loadFixture(): EpaAqsFixtureDataset {
    if (this.cachedFixture) {
      return this.cachedFixture;
    }

    if (!fs.existsSync(this.fixturePath)) {
      throw new Error(`EPA AQS seed fixture not found at '${this.fixturePath}'`);
    }

    const stat = fs.statSync(this.fixturePath);
    if (stat.size > 20_000_000) {
      throw new Error(`EPA AQS fixture file exceeds 20MB limit: ${stat.size} bytes`);
    }

    const raw = fs.readFileSync(this.fixturePath, 'utf8');
    const parsed = JSON.parse(raw);
    const validated = EpaAqsFixtureDatasetSchema.parse(parsed);

    this.cachedFixture = validated;
    return validated;
  }

  async getSites(geography?: EconomicGeography): Promise<readonly EpaAqsMonitoringSite[]> {
    if (!this.enabled) {
      throw new EpaAqsDisabledError();
    }
    if (geography) {
      validateEpaAqsGeography(geography);
    }
    if (!this.seedMode) {
      throw new EpaAqsSeedModeViolationError(
        'getSites() currently supports seed-mode fixture lookup; use querySummaries() for authorized live queries'
      );
    }

    const fixture = this.loadFixture();
    if (!geography) {
      return fixture.sites;
    }
    return fixture.sites.filter((site) => matchesSiteGeography(site, geography));
  }

  async querySummaries(rawQuery: EpaAqsQuery): Promise<EpaAqsQueryResult> {
    if (!this.enabled) {
      throw new EpaAqsDisabledError();
    }

    const query = EpaAqsQuerySchema.parse(rawQuery);
    validateEpaAqsGeography(query.geography);

    if (this.seedMode) {
      return this.resolveSeedQuery(query);
    }

    return this.fetchLiveSummaries(query);
  }

  private resolveSeedQuery(query: ParsedEpaAqsQuery): EpaAqsQueryResult {
    const fixture = this.loadFixture();
    const requestedPollutants: readonly EpaAqsPollutantSymbol[] =
      query.pollutants ?? EPA_AQS_CRITERIA_POLLUTANTS;

    const matchedSites = fixture.sites.filter((site) =>
      matchesSiteGeography(site, query.geography, query.radius_km)
    );
    const matchedSiteIds = new Set(matchedSites.map((s) => s.site_id));

    const matchedSummaries = fixture.summaries.filter((rec) => {
      if (!matchedSiteIds.has(rec.site_id)) return false;
      if (!requestedPollutants.includes(rec.pollutant_symbol)) return false;
      if (query.summary_period && rec.summary_period !== query.summary_period) return false;
      if (query.year !== undefined && rec.year !== query.year) return false;
      if (query.quarter !== undefined && rec.quarter !== query.quarter) return false;
      return true;
    });

    const summaries: EpaAqsSummaryRecord[] = [...matchedSummaries];

    if (query.include_unmonitored && matchedSites.length > 0) {
      const targetYear = query.year ?? 2024;
      const targetPeriod: EpaAqsSummaryPeriod = query.summary_period ?? 'annual';
      const targetQuarter: EpaAqsQuarter | null =
        targetPeriod === 'quarterly' ? (query.quarter ?? 1) : null;

      for (const site of matchedSites) {
        for (const symbol of requestedPollutants) {
          const code = getEpaAqsParameterCode(symbol);
          const siteMonitorsPollutant = site.monitored_parameters.includes(code);
          const alreadyHasRecord = summaries.some(
            (s) => s.site_id === site.site_id && s.parameter_code === code
          );
          if (!siteMonitorsPollutant && !alreadyHasRecord) {
            summaries.push(
              createUnmonitoredEpaAqsSummary({
                site_id: site.site_id,
                geography: {
                  level: 'county',
                  county_fips: site.county_fips,
                  state_fips: site.state_fips,
                  name: `${site.county_name} County, ${site.state_postal}`,
                },
                parameter_code: code,
                summary_period: targetPeriod,
                year: targetYear,
                quarter: targetQuarter,
              })
            );
          }
        }
      }
    }

    const pollutantCoverage = summarizeEpaAqsPollutantCoverage(
      matchedSites,
      summaries,
      requestedPollutants
    );

    return EpaAqsQueryResultSchema.parse({
      geography: query.geography,
      data_classification: EPA_AQS_DATA_CLASSIFICATION,
      is_real_time: false,
      sites: matchedSites,
      summaries,
      pollutant_coverage: pollutantCoverage,
      provenance: createEpaAqsProvenance(this.clock, 'seed'),
      advisory_disclaimer: EPA_AQS_HISTORICAL_DISCLAIMER,
    });
  }

  private async fetchLiveSummaries(query: ParsedEpaAqsQuery): Promise<EpaAqsQueryResult> {
    if (!this.allowLiveCalls) {
      throw new EpaAqsSeedModeViolationError();
    }
    if (!this.email || !this.apiKey) {
      throw new EpaAqsCredentialsMissingError();
    }

    const requestedPollutants: readonly EpaAqsPollutantSymbol[] =
      query.pollutants ?? EPA_AQS_CRITERIA_POLLUTANTS;
    const summaryPeriod: EpaAqsSummaryPeriod = query.summary_period ?? 'annual';
    const targetYear = query.year ?? 2024;
    const paramCodes = requestedPollutants.map((p) => getEpaAqsParameterCode(p)).join(',');

    const pathSuffix = buildLiveSummaryPath(query.geography, summaryPeriod);
    const normalizedBase = this.endpointUrl.endsWith('/')
      ? this.endpointUrl.slice(0, -1)
      : this.endpointUrl;
    const url = new URL(`${normalizedBase}/${pathSuffix}`);

    url.searchParams.set('email', this.email);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('param', paramCodes);
    url.searchParams.set('bdate', formatAqsDate(targetYear, false));
    url.searchParams.set('edate', formatAqsDate(targetYear, true));
    applyGeographyParams(url, query.geography, query.radius_km);

    let response: Awaited<ReturnType<typeof pinnedFetch>>;
    try {
      response = await pinnedFetch(url, {
        headers: { Accept: 'application/json' },
        allowedHosts: ['aqs.epa.gov'],
        allowedPaths: [{ host: 'aqs.epa.gov', pathPrefix: '/data/api' }],
        timeoutMs: 10_000,
        maxBytes: 5 * 1024 * 1024,
        ...this.pinnedFetchOptions,
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const redacted = rawMessage
        .replace(/([?&]email=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]');
      if (err instanceof Error) {
        err.message = redacted;
        throw err;
      }
      throw new Error(redacted);
    }

    if (!response.ok) {
      throw new Error(`EPA AQS endpoint returned HTTP ${response.status}: ${response.statusText}`);
    }

    const rawJson = await response.json();
    const wire = RawEpaAqsSummaryResponseSchema.parse(rawJson);
    const headerStatus = wire.Header[0]?.status;
    if (headerStatus === 'Failed') {
      throw new Error('EPA AQS API returned status Failed');
    }

    const summaries = wire.Data.map((row) =>
      normalizeLiveSummaryRow(row, summaryPeriod, query.geography)
    ).filter((rec): rec is EpaAqsSummaryRecord => {
      if (!rec) return false;
      if (query.quarter !== undefined && rec.quarter !== query.quarter) return false;
      return true;
    });

    const pollutantCoverage = summarizeEpaAqsPollutantCoverage([], summaries, requestedPollutants);

    return EpaAqsQueryResultSchema.parse({
      geography: query.geography,
      data_classification: EPA_AQS_DATA_CLASSIFICATION,
      is_real_time: false,
      sites: [],
      summaries,
      pollutant_coverage: pollutantCoverage,
      provenance: createEpaAqsProvenance(this.clock, 'live'),
      advisory_disclaimer: EPA_AQS_HISTORICAL_DISCLAIMER,
    });
  }
}
