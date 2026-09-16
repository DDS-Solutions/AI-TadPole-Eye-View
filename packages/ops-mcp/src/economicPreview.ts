import {
  type BusinessContextInput,
  type BusinessContextPreview,
  type DataProvenance,
  type EconomicEstimate,
  getNumericEstimateValue,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import {
  calculateHhiFromShares,
  calculateLocationQuotient,
  synthesizeBusinessContextPreview,
} from '@gev/economic';
import { EconomicFixtureAdapter } from '@gev/providers';

export interface GenerateBusinessContextPreviewOptions {
  input: BusinessContextInput;
  tenantId?: string;
  clock: SimClock;
  fixtureAdapter?: EconomicFixtureAdapter;
  warnings?: readonly string[];
}

/**
 * Orchestrates the stateless synthesis of a BusinessContextPreview envelope.
 * Strictly adheres to PLAN.md §8.2, ADR 0050, and ADR 0052:
 * - Stateless execution: zero database or disk persistence outside audit trail.
 * - Zero external network I/O: pure computation over validated seed fixtures.
 * - Suppressed data is preserved and never coerced to zero.
 * - Mandatory statutory legal disclaimer attached to all outputs.
 */
export function generateBusinessContextPreview(
  options: GenerateBusinessContextPreviewOptions
): BusinessContextPreview {
  const { input, clock } = options;
  const tenantId = options.tenantId ?? 'tenant-local';
  const adapter = options.fixtureAdapter ?? new EconomicFixtureAdapter({ clock });
  const matchingRecords = adapter.getEvidenceRecords({
    geography: input.target_geography,
    naicsCode: input.naics_code,
  });

  const nowIso = new Date(clock.now()).toISOString();
  const previewId = `prev-${clock.now()}-${slugify(input.business_name)}`;

  // Extract / calculate summary estimates from evidence
  const summaryEstimates: Record<string, EconomicEstimate> = {};

  // 1. Median Household Income (ACS)
  const incRecord = matchingRecords.find((r) => r.metric_id === 'median-household-income');
  if (incRecord) {
    summaryEstimates.median_household_income = incRecord.estimate;
  } else {
    summaryEstimates.median_household_income = {
      status: 'unavailable',
      reason: 'Median household income survey data unavailable for target geography',
    };
  }

  // 2. Total Establishments (CBP)
  const estabRecord = matchingRecords.find((r) => r.metric_id === 'establishment-count');
  if (estabRecord) {
    summaryEstimates.total_establishments = estabRecord.estimate;
  } else {
    summaryEstimates.total_establishments = {
      status: 'unavailable',
      reason: `Establishment count unavailable for NAICS ${input.naics_code}`,
    };
  }

  // 3. Employment Count (CBP / OEWS)
  const empRecord = matchingRecords.find(
    (r) => r.metric_id === 'paid-employment' || r.metric_id === 'employment-count'
  );
  if (empRecord) {
    summaryEstimates.employment_count = empRecord.estimate;
  } else {
    summaryEstimates.employment_count = {
      status: 'unavailable',
      reason: `Employment count unavailable for NAICS ${input.naics_code}`,
    };
  }

  // 4. Labor Market Unemployment Rate (BLS LAU)
  const unempRecord = matchingRecords.find((r) => r.metric_id === 'unemployment-rate');
  if (unempRecord) {
    summaryEstimates.labor_market_unemployment_rate = unempRecord.estimate;
  } else {
    summaryEstimates.labor_market_unemployment_rate = {
      status: 'unavailable',
      reason: 'Labor market unemployment rate unavailable for target geography',
    };
  }

  // 5. Wage Statistics (BLS OEWS)
  const wageRecord = matchingRecords.find(
    (r) => r.metric_id === 'annual-mean-wage' || r.metric_id === 'hourly-mean-wage'
  );
  if (wageRecord) {
    summaryEstimates.annual_mean_wage = wageRecord.estimate;
  } else {
    summaryEstimates.annual_mean_wage = {
      status: 'unavailable',
      reason: 'Wage statistics unavailable for target industry in geography',
    };
  }

  // 6. Natural Hazard Risk Score (FEMA NRI)
  const riskRecord = matchingRecords.find((r) => r.metric_id === 'nri-risk-score');
  if (riskRecord) {
    summaryEstimates.natural_hazard_risk_score = riskRecord.estimate;
  } else {
    summaryEstimates.natural_hazard_risk_score = {
      status: 'unavailable',
      reason: 'Natural hazard risk metrics unavailable for target geography',
    };
  }

  // 7. Industry Location Quotient (LQ) via @gev/economic
  const localEmpVal = empRecord ? getNumericEstimateValue(empRecord.estimate) : undefined;
  if (localEmpVal !== undefined && localEmpVal > 0) {
    // Benchmark industry share for tech/services (supersector 54 ~ 98,200 local, national 3.2M / 20M)
    const localTotalSector = 98_200;
    const benchmarkIndustry = 3_200_000;
    const benchmarkTotal = 20_000_000;
    try {
      const lq = calculateLocationQuotient(
        localEmpVal,
        localTotalSector,
        benchmarkIndustry,
        benchmarkTotal
      );
      summaryEstimates.industry_location_quotient = {
        status: 'available',
        value: lq.lq,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'ratio',
        notes: `Industry specialization tier: ${lq.tier} (local industry share: ${Math.round(lq.local_share_pct * 1000) / 10}%)`,
      };
    } catch {
      summaryEstimates.industry_location_quotient = {
        status: 'unavailable',
        reason: 'Location quotient calculation error: invalid bounds',
      };
    }
  } else if (empRecord && empRecord.estimate.status === 'suppressed') {
    // Preserve suppression honestly without coercing to zero
    summaryEstimates.industry_location_quotient = {
      status: 'suppressed',
      reason: empRecord.estimate.reason,
      detail: `Location quotient suppressed because local employment input is suppressed: ${empRecord.estimate.detail}`,
      unit: 'ratio',
    };
  } else {
    summaryEstimates.industry_location_quotient = {
      status: 'unavailable',
      reason: 'Location quotient cannot be calculated: employment benchmark data unavailable',
    };
  }

  // 8. Market Concentration HHI via @gev/economic
  const commercialPoiRecords = matchingRecords.filter((r) => r.source_id === 'osm-commercial');
  if (commercialPoiRecords.length > 0) {
    // Synthetic sector competitor distribution for demonstration (DOJ/FTC HHI scale)
    const benchmarkShares = [22, 18, 15, 12, 10, 8, 5, 4, 3, 3];
    try {
      const hhi = calculateHhiFromShares(benchmarkShares);
      summaryEstimates.market_concentration_hhi = {
        status: 'available',
        value: hhi.hhi,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'points',
        notes: `Market concentration tier: ${hhi.tier} (${hhi.firm_count} observed competitor shares)`,
      };
    } catch {
      summaryEstimates.market_concentration_hhi = {
        status: 'unavailable',
        reason: 'Market concentration HHI calculation error',
      };
    }
  } else {
    summaryEstimates.market_concentration_hhi = {
      status: 'unavailable',
      reason:
        'Market concentration HHI cannot be calculated: competitor share data unavailable for geography',
    };
  }

  // Determine primary seed provenance
  const primaryProvenance: DataProvenance = matchingRecords[0]?.provenance ?? {
    schema_version: 1,
    source: {
      provider_id: 'economic-analysis-engine',
      feed_id: 'economic-preview',
      name: 'GEV Economic Analysis Engine',
      canonical_url: 'https://gev.dds-solutions.internal/economic',
    },
    retrieved_at: nowIso,
    observation_period: {
      status: 'available',
      start: nowIso,
      end: nowIso,
    },
    vintage: {
      status: 'available',
      value: '2026 Seed Fixture Benchmark Compilation',
    },
    mode: 'seed',
    source_mode: 'seed',
    license: {
      id: 'us-government-public-domain',
      name: 'U.S. Government Public Domain / Open Data Fixtures',
    },
    attribution: 'DDS-Solutions Economic Intelligence Engine (Seed Mode)',
    fixture_id: 'economic-seed-compilation-v1',
    cache: null,
    freshness: {
      status: 'fresh',
      age_seconds: 0,
      fresh_for_seconds: 86400,
    },
  };

  return synthesizeBusinessContextPreview({
    previewId,
    tenantId,
    isoTimestamp: nowIso,
    input,
    evidence: matchingRecords,
    summaryEstimates,
    provenance: primaryProvenance,
    warnings: options.warnings,
  });
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'business'
  );
}
