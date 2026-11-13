import {
  type BusinessContextInput,
  type BusinessContextPreview,
  type DataProvenance,
  type EconomicEstimate,
  getNumericEstimateValue,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import {
  calculateLocationQuotient,
  createDefaultSynthesisProvenance,
  synthesizeAggregateProvenance,
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

  // 7. Industry Location Quotient (LQ) via @gev/economic (only from observed benchmark records)
  const allAdapterRecords = adapter.getAllRecords();
  const localTotalEmpRecord = matchingRecords.find(
    (r) => r.metric_id === 'total-local-employment' || r.tags?.includes('all-sectors-total')
  );
  const benchmarkIndustryRec = allAdapterRecords.find(
    (r) =>
      r.geography.level === 'nation' &&
      (r.metric_id === 'paid-employment' || r.metric_id === 'total-employment') &&
      r.tags?.some((t) => t === `naics-${input.naics_code}`)
  );
  const benchmarkTotalRec = allAdapterRecords.find(
    (r) =>
      r.geography.level === 'nation' &&
      (r.metric_id === 'total-employment' || r.metric_id === 'paid-employment') &&
      (r.tags?.includes('all-sectors-total') || r.evidence_id.includes('000000'))
  );

  const localEmpVal = empRecord ? getNumericEstimateValue(empRecord.estimate) : undefined;
  const localTotalVal = localTotalEmpRecord
    ? getNumericEstimateValue(localTotalEmpRecord.estimate)
    : undefined;
  const benchmarkIndustryVal = benchmarkIndustryRec
    ? getNumericEstimateValue(benchmarkIndustryRec.estimate)
    : undefined;
  const benchmarkTotalVal = benchmarkTotalRec
    ? getNumericEstimateValue(benchmarkTotalRec.estimate)
    : undefined;

  if (empRecord && empRecord.estimate.status === 'suppressed') {
    // Preserve suppression honestly without coercing to zero
    summaryEstimates.industry_location_quotient = {
      status: 'suppressed',
      reason: empRecord.estimate.reason,
      detail: `Location quotient suppressed because local employment input is suppressed: ${empRecord.estimate.detail}`,
      unit: 'ratio',
    };
  } else if (
    localEmpVal !== undefined &&
    localEmpVal > 0 &&
    localTotalVal !== undefined &&
    benchmarkIndustryVal !== undefined &&
    benchmarkTotalVal !== undefined
  ) {
    try {
      const lq = calculateLocationQuotient(
        localEmpVal,
        localTotalVal,
        benchmarkIndustryVal,
        benchmarkTotalVal
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
  } else {
    summaryEstimates.industry_location_quotient = {
      status: 'unavailable',
      reason:
        'Location quotient cannot be calculated: benchmark industry or total employment records unavailable',
    };
  }

  // 8. Market Concentration HHI (never fabricated from synthetic benchmark shares)
  summaryEstimates.market_concentration_hhi = {
    status: 'unavailable',
    reason:
      'Market concentration HHI cannot be calculated: observed firm-level market shares unavailable',
  };

  // Derive primary provenance strictly from matching evidence or honest unavailable fallback
  const primaryProvenance: DataProvenance =
    matchingRecords.length > 0
      ? synthesizeAggregateProvenance(
          matchingRecords.map((r) => r.provenance),
          nowIso
        )
      : createDefaultSynthesisProvenance(
          nowIso,
          'No matching economic evidence records for target geography and NAICS code'
        );

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
