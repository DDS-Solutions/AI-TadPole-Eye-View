import { describe, expect, it } from 'vitest';
import {
  WorkforceAnalysisInputSchema,
  WorkforceOccupationalSpecializationSchema,
  WorkforceUnemploymentSummarySchema,
  WorkforceWageDifferentialSummarySchema,
} from '../src/index.js';

describe('Workforce Analysis Contracts (PLAN.md §10.2, ADR 0061)', () => {
  const validGeography = {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  };

  it('validates a minimal valid WorkforceAnalysisInput', () => {
    const parsed = WorkforceAnalysisInputSchema.parse({
      target_geography: validGeography,
      soc_code: '15-1252',
    });
    expect(parsed.soc_code).toBe('15-1252');
    expect(parsed.tenant_id).toBe('tenant-local');
  });

  it('defaults soc_code to 00-0000 (all occupations) when omitted', () => {
    const parsed = WorkforceAnalysisInputSchema.parse({
      target_geography: validGeography,
    });
    expect(parsed.soc_code).toBe('00-0000');
  });

  it('strictly rejects employee or applicant personal data (PII defense)', () => {
    expect(() =>
      WorkforceAnalysisInputSchema.parse({
        target_geography: validGeography,
        soc_code: '15-1252',
        applicant_id: 'app-99881',
      })
    ).toThrow(/worker-level PII/i);

    expect(() =>
      WorkforceAnalysisInputSchema.parse({
        target_geography: validGeography,
        soc_code: '15-1252',
        worker_name: 'Jane Doe',
      })
    ).toThrow(/worker-level PII/i);

    expect(() =>
      WorkforceAnalysisInputSchema.parse({
        target_geography: validGeography,
        soc_code: '15-1252',
        nested: { ssn: '000-11-2222' },
      })
    ).toThrow(/worker-level PII/i);
  });

  it('validates WorkforceWageDifferentialSummarySchema and preserves suppressed percentiles', () => {
    const summary = WorkforceWageDifferentialSummarySchema.parse({
      soc_code: '15-1252',
      occupation_title: 'Software Developers',
      hourly_percentiles: {
        pct10: {
          status: 'available',
          value: 38.5,
          unit: 'USD_per_hour',
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
        },
        pct25: {
          status: 'available',
          value: 48.2,
          unit: 'USD_per_hour',
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
        },
        median: {
          status: 'available',
          value: 62.4,
          unit: 'USD_per_hour',
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
        },
        pct75: {
          status: 'available',
          value: 81.0,
          unit: 'USD_per_hour',
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
        },
        pct90: {
          status: 'suppressed',
          reason: 'disclosure_avoidance',
          detail: 'Top-coded wage rate >= $115.00/hour',
          bounds: { lower_bound: 115.0 },
        },
        mean: {
          status: 'available',
          value: 65.8,
          unit: 'USD_per_hour',
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
        },
      },
      annual_percentiles: {
        pct10: {
          status: 'available',
          value: 80080,
          unit: 'USD',
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
        },
        pct25: {
          status: 'available',
          value: 100250,
          unit: 'USD',
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
        },
        median: {
          status: 'available',
          value: 129790,
          unit: 'USD',
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
        },
        pct75: {
          status: 'available',
          value: 168480,
          unit: 'USD',
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
        },
        pct90: {
          status: 'suppressed',
          reason: 'disclosure_avoidance',
          detail: 'Top-coded wage rate >= $239,200/year',
          bounds: { lower_bound: 239200 },
        },
        mean: {
          status: 'available',
          value: 136860,
          unit: 'USD',
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
        },
      },
      ratio_90_10: {
        status: 'suppressed',
        reason: 'disclosure_avoidance',
        detail: 'Cannot calculate 90/10 ratio because 90th percentile is top-coded',
      },
      ratio_75_25: {
        status: 'available',
        value: 1.68,
        unit: 'ratio',
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
      },
      benchmark_median_hourly_usd: {
        status: 'available',
        value: 55.0,
        unit: 'USD_per_hour',
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
      },
      local_to_benchmark_ratio: {
        status: 'available',
        value: 1.13,
        unit: 'ratio',
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
      },
      dispersion_classification: 'moderate',
    });

    expect(summary.hourly_percentiles.pct90.status).toBe('suppressed');
    expect(summary.ratio_90_10.status).toBe('suppressed');
  });

  it('validates WorkforceOccupationalSpecializationSchema with location quotient', () => {
    const spec = WorkforceOccupationalSpecializationSchema.parse({
      soc_code: '15-1252',
      occupation_title: 'Software Developers',
      local_employment: {
        status: 'available',
        value: 24500,
        unit: 'count',
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
      },
      benchmark_employment: {
        status: 'available',
        value: 1600000,
        unit: 'count',
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
      },
      location_quotient: 1.84,
      tier: 'high_specialization',
    });
    expect(spec.location_quotient).toBe(1.84);
    expect(spec.tier).toBe('high_specialization');
  });

  it('validates WorkforceUnemploymentSummarySchema from BLS LAU', () => {
    const lau = WorkforceUnemploymentSummarySchema.parse({
      period: 'M06',
      year: '2024',
      civilian_labor_force: {
        status: 'available',
        value: 750000,
        unit: 'count',
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
      },
      employed_count: {
        status: 'available',
        value: 724000,
        unit: 'count',
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
      },
      unemployed_count: {
        status: 'available',
        value: 26000,
        unit: 'count',
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
      },
      unemployment_rate_pct: {
        status: 'available',
        value: 3.5,
        unit: 'percent',
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
      },
      monthly_change_pct_points: -0.2,
      unemployment_status: 'low',
    });
    expect(lau.unemployment_rate_pct.status).toBe('available');
    expect(lau.unemployment_status).toBe('low');
  });
});
