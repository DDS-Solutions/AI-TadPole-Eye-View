import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type EconomicEvidenceRecord,
  type EconomicGeography,
  WORKFORCE_LABOR_MARKET_SIGNAL_DISCLAIMER,
  getNumericEstimateValue,
} from '@gev/contracts';
import { analyzeWorkforceContext } from '../src/index.js';

describe('Pure Workforce Analysis Engine (PLAN.md §10.2, ADR 0061)', () => {
  const targetGeography: EconomicGeography = {
    level: 'cbsa',
    cbsa_code: '12420',
    name: 'Austin-Round Rock-Georgetown, TX',
  };

  const sampleProvenance = {
    schema_version: 1 as const,
    source: {
      provider_id: 'bls-oews',
      feed_id: 'oews-annual',
      name: 'BLS OEWS',
      canonical_url: 'https://www.bls.gov/oes/',
    },
    retrieved_at: '2026-09-24T12:00:00.000Z',
    observation_period: {
      status: 'available' as const,
      start: '2024-05-01T00:00:00.000Z',
      end: '2024-05-31T23:59:59.000Z',
    },
    vintage: { status: 'available' as const, value: 'May 2024' },
    mode: 'seed' as const,
    source_mode: 'seed' as const,
    license: { id: 'us-government-public-domain', name: 'Public Domain' },
    attribution: 'Bureau of Labor Statistics',
    fixture_id: 'bls-oews-synthetic-v1',
    cache: null,
    freshness: { status: 'fresh' as const, age_seconds: 0, fresh_for_seconds: 86400 },
  };

  function makeRec(
    evidence_id: string,
    variable_name: string,
    metric_id: string,
    label: string,
    geography: EconomicGeography,
    val: number,
    unit: string
  ): EconomicEvidenceRecord {
    return {
      evidence_id,
      source_id: evidence_id.startsWith('ev-lau') ? 'bls-lau' : 'bls-oews',
      metric_id,
      variable_name,
      label,
      geography,
      estimate: {
        status: 'available',
        value: val,
        unit,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
      },
      provenance: sampleProvenance,
    };
  }

  const natGeo: EconomicGeography = { level: 'nation', country_code: 'US' };

  const mockOewsEvidence: EconomicEvidenceRecord[] = [
    makeRec(
      'ev-oews-151252-h-pct10',
      'H_PCT10',
      'hourly-pct10-wage',
      'Hourly 10th Percentile Wage (SOC 15-1252)',
      targetGeography,
      38.5,
      'USD_per_hour'
    ),
    makeRec(
      'ev-oews-151252-h-pct25',
      'H_PCT25',
      'hourly-pct25-wage',
      'Hourly 25th Percentile Wage (SOC 15-1252)',
      targetGeography,
      48.0,
      'USD_per_hour'
    ),
    makeRec(
      'ev-oews-151252-h-median',
      'H_MEDIAN',
      'hourly-median-wage',
      'Hourly Median Wage (SOC 15-1252)',
      targetGeography,
      65.0,
      'USD_per_hour'
    ),
    makeRec(
      'ev-oews-151252-h-pct75',
      'H_PCT75',
      'hourly-pct75-wage',
      'Hourly 75th Percentile Wage (SOC 15-1252)',
      targetGeography,
      82.5,
      'USD_per_hour'
    ),
    makeRec(
      'ev-oews-151252-h-pct90',
      'H_PCT90',
      'hourly-pct90-wage',
      'Hourly 90th Percentile Wage (SOC 15-1252)',
      targetGeography,
      98.0,
      'USD_per_hour'
    ),
    makeRec(
      'ev-oews-151252-h-mean',
      'H_MEAN',
      'hourly-mean-wage',
      'Hourly Mean Wage (SOC 15-1252)',
      targetGeography,
      68.2,
      'USD_per_hour'
    ),
    makeRec(
      'ev-oews-151252-tot-emp',
      'TOT_EMP',
      'total-employment',
      'Software Developers Employment in Austin (SOC 15-1252)',
      targetGeography,
      24500,
      'count'
    ),
    makeRec(
      'ev-oews-000000-tot-emp',
      'TOT_EMP',
      'total-local-employment',
      'All Occupations Total Employment in Austin (SOC 00-0000)',
      targetGeography,
      1250000,
      'count'
    ),
    makeRec(
      'ev-oews-nat-151252-tot-emp',
      'TOT_EMP',
      'total-employment',
      'National Software Developers Employment (SOC 15-1252)',
      natGeo,
      1600000,
      'count'
    ),
    makeRec(
      'ev-oews-nat-000000-tot-emp',
      'TOT_EMP',
      'total-employment',
      'National Total Employment (SOC 00-0000)',
      natGeo,
      154000000,
      'count'
    ),
    makeRec(
      'ev-oews-nat-h-median',
      'H_MEDIAN',
      'hourly-median-wage',
      'National Median Hourly Wage',
      natGeo,
      55.0,
      'USD_per_hour'
    ),
  ];

  const mockLauEvidence: EconomicEvidenceRecord[] = [
    makeRec(
      'ev-lau-rate-12420-2024-m06',
      'LAU_RATE',
      'unemployment-rate',
      'Unemployment Rate in Austin CBSA',
      targetGeography,
      3.4,
      'percent'
    ),
    makeRec(
      'ev-lau-labor-force-12420-2024-m06',
      'LAU_LABOR_FORCE',
      'labor-force',
      'Civilian Labor Force in Austin CBSA',
      targetGeography,
      1350000,
      'count'
    ),
    makeRec(
      'ev-lau-employed-12420-2024-m06',
      'LAU_EMPLOYED',
      'employed-count',
      'Resident Employed in Austin CBSA',
      targetGeography,
      1304100,
      'count'
    ),
    makeRec(
      'ev-lau-unemployed-12420-2024-m06',
      'LAU_UNEMPLOYED',
      'unemployed-count',
      'Resident Unemployed in Austin CBSA',
      targetGeography,
      45900,
      'count'
    ),
  ];

  it('runs deterministic workforce analysis with wage percentiles and unemployment dynamics', () => {
    const clockTimestamp = '2026-09-24T12:00:00.000Z';
    const result = analyzeWorkforceContext(
      {
        target_geography: targetGeography,
        soc_code: '15-1252',
        oews_evidence: mockOewsEvidence,
        lau_evidence: mockLauEvidence,
      },
      clockTimestamp
    );

    expect(result.schema_version).toBe(1);
    expect(result.soc_code).toBe('15-1252');
    expect(result.occupation_title).toBe('Software Developers');
    expect(result.signal_type).toBe('aggregate_labor_market_survey_signal');
    expect(result.disclaimer).toBe(WORKFORCE_LABOR_MARKET_SIGNAL_DISCLAIMER);

    // Wage percentiles
    const wages = result.wage_differentials;
    expect(wages.hourly_percentiles.pct10.status).toBe('available');
    expect(getNumericEstimateValue(wages.hourly_percentiles.pct10)).toBe(38.5);
    expect(getNumericEstimateValue(wages.hourly_percentiles.median)).toBe(65.0);
    expect(getNumericEstimateValue(wages.hourly_percentiles.pct90)).toBe(98.0);

    // Wage ratios
    expect(wages.ratio_90_10.status).toBe('available');
    const r9010 = getNumericEstimateValue(wages.ratio_90_10);
    expect(r9010).toBeCloseTo(98.0 / 38.5, 1);
    expect(wages.dispersion_classification).toBe('moderate');

    // Benchmark comparison
    expect(wages.local_to_benchmark_ratio.status).toBe('available');
    expect(getNumericEstimateValue(wages.local_to_benchmark_ratio)).toBeCloseTo(65.0 / 55.0, 1);

    // Occupational Specialization (LQ)
    const spec = result.occupational_specialization;
    expect(spec.location_quotient).toBeGreaterThan(1.2);
    expect(spec.tier).toBe('high_specialization');

    // Unemployment dynamics
    const unemp = result.unemployment_dynamics;
    expect(unemp.unemployment_rate_pct.status).toBe('available');
    expect(getNumericEstimateValue(unemp.unemployment_rate_pct)).toBe(3.4);
    expect(unemp.unemployment_status).toBe('low');
  });

  it('preserves top-coded and suppressed wage data without zero-coercion', () => {
    const suppressedOewsEvidence: EconomicEvidenceRecord[] = [
      {
        evidence_id: 'ev-oews-topcoded-h-pct90',
        source_id: 'bls-oews',
        metric_id: 'hourly-pct90-wage',
        variable_name: 'H_PCT90',
        label: 'Top-Coded 90th Percentile Wage',
        geography: targetGeography,
        estimate: {
          status: 'suppressed',
          reason: 'disclosure_avoidance',
          detail: 'Top-coded wage rate >= $115.00/hour',
          bounds: { lower_bound: 115.0 },
        },
        provenance: sampleProvenance,
      },
      {
        evidence_id: 'ev-oews-topcoded-h-pct10',
        source_id: 'bls-oews',
        metric_id: 'hourly-pct10-wage',
        variable_name: 'H_PCT10',
        label: '10th Percentile Wage',
        geography: targetGeography,
        estimate: {
          status: 'available',
          value: 40.0,
          unit: 'USD_per_hour',
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
        },
        provenance: sampleProvenance,
      },
    ];

    const result = analyzeWorkforceContext(
      {
        target_geography: targetGeography,
        soc_code: '15-1252',
        oews_evidence: suppressedOewsEvidence,
        lau_evidence: [],
      },
      '2026-09-24T12:00:00.000Z'
    );

    // 90th percentile must remain suppressed
    expect(result.wage_differentials.hourly_percentiles.pct90.status).toBe('suppressed');
    if (result.wage_differentials.hourly_percentiles.pct90.status === 'suppressed') {
      expect(result.wage_differentials.hourly_percentiles.pct90.reason).toBe(
        'disclosure_avoidance'
      );
      expect(result.wage_differentials.hourly_percentiles.pct90.bounds?.lower_bound).toBe(115.0);
    }

    // 90/10 ratio must be suppressed and NEVER coerced to zero
    expect(result.wage_differentials.ratio_90_10.status).toBe('suppressed');
    expect(getNumericEstimateValue(result.wage_differentials.ratio_90_10)).toBeUndefined();
    expect(result.wage_differentials.dispersion_classification).toBe('suppressed');
  });

  it('rejects worker personal identifiers (PII defense)', () => {
    expect(() =>
      analyzeWorkforceContext(
        {
          target_geography: targetGeography,
          soc_code: '15-1252',
          // @ts-expect-error PII injection
          worker_name: 'Alice Developer',
        },
        '2026-09-24T12:00:00.000Z'
      )
    ).toThrow(/worker-level PII/i);

    expect(() =>
      analyzeWorkforceContext(
        {
          target_geography: targetGeography,
          soc_code: '15-1252',
          // @ts-expect-error PII injection
          applicant_id: 'candidate-12345',
        },
        '2026-09-24T12:00:00.000Z'
      )
    ).toThrow(/worker-level PII/i);
  });

  it('meets performance threshold: p95 execution time < 15ms', () => {
    // Warmup JIT
    for (let w = 0; w < 50; w++) {
      analyzeWorkforceContext(
        {
          target_geography: targetGeography,
          soc_code: '15-1252',
          oews_evidence: mockOewsEvidence,
          lau_evidence: mockLauEvidence,
        },
        '2026-09-24T12:00:00.000Z'
      );
    }

    // Tuned for CI runners: batchSize=10 amortizes scheduler quantum preemption
    const batchSize = 10;
    const batchCount = 50; // 500 total iterations
    const latencies: number[] = [];

    for (let b = 0; b < batchCount; b++) {
      const start = performance.now();
      for (let j = 0; j < batchSize; j++) {
        analyzeWorkforceContext(
          {
            target_geography: targetGeography,
            soc_code: '15-1252',
            oews_evidence: mockOewsEvidence,
            lau_evidence: mockLauEvidence,
          },
          '2026-09-24T12:00:00.000Z'
        );
      }
      const elapsed = performance.now() - start;
      latencies.push(elapsed / batchSize);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(batchCount * 0.5)]!;
    const p95 = latencies[Math.floor(batchCount * 0.95)]!;
    const p99 = latencies[Math.floor(batchCount * 0.99)]!;

    console.log(
      `[BENCHMARK] Pure Workforce Analysis Latency (${batchSize * batchCount} iterations): p50=${p50.toFixed(
        3
      )}ms, p95=${p95.toFixed(3)}ms, p99=${p99.toFixed(3)}ms`
    );

    expect(p95).toBeLessThan(15.0);
  });

  it('property test: non-coercion and non-negative ratios across arbitrary numeric distributions', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 10, max: 200, noNaN: true }),
        fc.float({ min: 10, max: 200, noNaN: true }),
        (pct10, pct90) => {
          const lo = Math.min(pct10, pct90);
          const hi = Math.max(pct10, pct90);

          const ev: EconomicEvidenceRecord[] = [
            {
              evidence_id: 'p-ev-pct10',
              source_id: 'bls-oews',
              metric_id: 'hourly-pct10-wage',
              variable_name: 'H_PCT10',
              label: '10th',
              geography: targetGeography,
              estimate: {
                status: 'available',
                value: lo,
                unit: 'USD_per_hour',
                margin_of_error: null,
                confidence_level: null,
                sample_size: null,
              },
              provenance: sampleProvenance,
            },
            {
              evidence_id: 'p-ev-pct90',
              source_id: 'bls-oews',
              metric_id: 'hourly-pct90-wage',
              variable_name: 'H_PCT90',
              label: '90th',
              geography: targetGeography,
              estimate: {
                status: 'available',
                value: hi,
                unit: 'USD_per_hour',
                margin_of_error: null,
                confidence_level: null,
                sample_size: null,
              },
              provenance: sampleProvenance,
            },
          ];

          const res = analyzeWorkforceContext(
            {
              target_geography: targetGeography,
              soc_code: '15-1252',
              oews_evidence: ev,
              lau_evidence: [],
            },
            '2026-09-24T12:00:00.000Z'
          );

          const r9010 = getNumericEstimateValue(res.wage_differentials.ratio_90_10);
          expect(r9010).toBeDefined();
          expect(r9010!).toBeGreaterThanOrEqual(1.0);
          expect(Number.isFinite(r9010!)).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});
