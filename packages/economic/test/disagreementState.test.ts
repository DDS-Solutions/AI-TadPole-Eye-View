import type { EconomicEstimate, EconomicEvidenceRecord, EconomicGeography } from '@gev/contracts';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createDisagreementState,
  evaluateSourceLinkedDisagreement,
} from '../src/disagreementState.js';
import { analyzeMarketContext } from '../src/marketAnalysis.js';

describe('Source-Linked Disagreement Evaluation & Preservation (Task 9.4 & ADR 0058)', () => {
  const mockClockTimestamp = '2026-09-21T12:00:00.000Z';

  const mockGeographyTravis: EconomicGeography = {
    level: 'county',
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  };

  const mockProvenance = {
    schema_version: 1 as const,
    source: {
      provider_id: 'census-acs',
      feed_id: 'acs-5yr-profiles',
      name: 'U.S. Census Bureau ACS 5-Year Estimates',
      canonical_url: 'https://api.census.gov/data',
    },
    retrieved_at: mockClockTimestamp,
    observation_period: {
      status: 'available' as const,
      start: '2020-01-01T00:00:00.000Z',
      end: '2024-12-31T23:59:59.000Z',
    },
    vintage: {
      status: 'available' as const,
      value: '2020-2024 ACS 5-Year Detailed Tables',
    },
    mode: 'seed' as const,
    source_mode: 'seed' as const,
    license: {
      id: 'us-government-public-domain',
      name: 'U.S. Government Work (Public Domain)',
    },
    attribution: 'U.S. Census Bureau ACS',
    fixture_id: 'census-acs-synthetic-v1',
    cache: null,
    freshness: {
      status: 'fresh' as const,
      age_seconds: 0,
      fresh_for_seconds: 86400,
    },
  };

  const expectedSignal = {
    source_metric: 'model-benchmark-density',
    variable_link: {
      source_id: 'gev-economic-model',
      variable_id: 'BENCHMARK_DENSITY',
      metric_id: 'density-expectation',
      vintage: '2026-Q3',
      attribution: 'GEV Model',
    },
    description: 'Model benchmark density',
    estimate: {
      status: 'available' as const,
      value: 100,
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
      unit: 'count',
    },
    provenance: mockProvenance,
  };

  it('returns null when observed value is within 15% threshold', () => {
    const observedSignal = {
      ...expectedSignal,
      source_metric: 'observed-density',
      estimate: {
        ...expectedSignal.estimate,
        value: 108, // 8% delta
      },
    };

    const result = evaluateSourceLinkedDisagreement({
      disagreementId: 'dis-01',
      indicatorKey: 'density',
      disagreementType: 'prediction_vs_observation',
      expectedMetric: expectedSignal.source_metric,
      expectedVariableLink: expectedSignal.variable_link,
      expectedDescription: expectedSignal.description,
      expectedEstimate: expectedSignal.estimate,
      expectedProvenance: expectedSignal.provenance,
      observedMetric: observedSignal.source_metric,
      observedVariableLink: observedSignal.variable_link,
      observedDescription: observedSignal.description,
      observedEstimate: observedSignal.estimate,
      observedProvenance: observedSignal.provenance,
    });

    expect(result).toBeNull();
  });

  it('preserves both signals with warning severity when delta is between 15% and 35%', () => {
    const observedEstimate: EconomicEstimate = {
      status: 'available',
      value: 125, // 25% higher
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
      unit: 'count',
    };

    const result = evaluateSourceLinkedDisagreement({
      disagreementId: 'dis-02',
      indicatorKey: 'density',
      disagreementType: 'prediction_vs_observation',
      expectedMetric: expectedSignal.source_metric,
      expectedVariableLink: expectedSignal.variable_link,
      expectedDescription: expectedSignal.description,
      expectedEstimate: expectedSignal.estimate,
      expectedProvenance: expectedSignal.provenance,
      observedMetric: 'osm-observed-density',
      observedVariableLink: expectedSignal.variable_link,
      observedDescription: 'OSM Observed Density',
      observedEstimate,
      observedProvenance: mockProvenance,
    });

    expect(result).not.toBeNull();
    expect(result?.severity).toBe('warning');
    expect(result?.resolution_state).toBe('unresolved_preserved');
    expect(result?.delta_metrics.relative_delta_pct).toBe(25);
    expect(result?.delta_metrics.direction).toBe('observed_higher');
    expect(result?.expected_signal.estimate.status).toBe('available');
    if (result?.expected_signal.estimate.status === 'available') {
      expect(result.expected_signal.estimate.value).toBe(100);
    }
    expect(result?.observed_signal.estimate.status).toBe('available');
    if (result?.observed_signal.estimate.status === 'available') {
      expect(result.observed_signal.estimate.value).toBe(125);
    }
  });

  it('preserves both signals with critical severity when delta exceeds 35%', () => {
    const observedEstimate: EconomicEstimate = {
      status: 'available',
      value: 50, // 50% lower
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
      unit: 'count',
    };

    const result = evaluateSourceLinkedDisagreement({
      disagreementId: 'dis-03',
      indicatorKey: 'density',
      disagreementType: 'prediction_vs_observation',
      expectedMetric: expectedSignal.source_metric,
      expectedVariableLink: expectedSignal.variable_link,
      expectedDescription: expectedSignal.description,
      expectedEstimate: expectedSignal.estimate,
      expectedProvenance: expectedSignal.provenance,
      observedMetric: 'osm-observed-density',
      observedVariableLink: expectedSignal.variable_link,
      observedDescription: 'OSM Observed Density',
      observedEstimate,
      observedProvenance: mockProvenance,
    });

    expect(result?.severity).toBe('critical');
    expect(result?.delta_metrics.direction).toBe('observed_lower');
    expect(result?.delta_description).toContain('50% lower');
  });

  it('preserves both signals upon status disparity (available vs suppressed)', () => {
    const suppressedEstimate: EconomicEstimate = {
      status: 'suppressed',
      reason: 'disclosure_avoidance',
      detail: 'Suppressed by Census Bureau',
    };

    const result = evaluateSourceLinkedDisagreement({
      disagreementId: 'dis-04',
      indicatorKey: 'density',
      disagreementType: 'status_disparity',
      expectedMetric: expectedSignal.source_metric,
      expectedVariableLink: expectedSignal.variable_link,
      expectedDescription: expectedSignal.description,
      expectedEstimate: expectedSignal.estimate,
      expectedProvenance: expectedSignal.provenance,
      observedMetric: 'cbp-suppressed-metric',
      observedVariableLink: expectedSignal.variable_link,
      observedDescription: 'CBP Suppressed Metric',
      observedEstimate: suppressedEstimate,
      observedProvenance: mockProvenance,
    });

    expect(result?.severity).toBe('info');
    expect(result?.delta_metrics.direction).toBe('status_divergence');
    expect(result?.delta_description).toContain(
      'Status disparity: expected available, observed suppressed'
    );
  });

  it('aggregates disagreement records into DisagreementState', () => {
    const state = createDisagreementState([]);
    expect(state.has_disagreements).toBe(false);
    expect(state.total_disagreements).toBe(0);
  });

  describe('Fast-Check Invariant Property Tests', () => {
    it('proves divergence >= 15% ALWAYS produces unresolved_preserved disagreement', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 10, max: 1000, noNaN: true }),
          fc.oneof(
            fc.double({ min: 0.05, max: 0.84, noNaN: true }),
            fc.double({ min: 1.16, max: 3.0, noNaN: true })
          ),
          (expectedVal, multiplier) => {
            const observedVal = expectedVal * multiplier;
            const expectedEstimate: EconomicEstimate = {
              status: 'available',
              value: expectedVal,
              margin_of_error: null,
              confidence_level: null,
              sample_size: null,
              unit: 'count',
            };
            const observedEstimate: EconomicEstimate = {
              status: 'available',
              value: observedVal,
              margin_of_error: null,
              confidence_level: null,
              sample_size: null,
              unit: 'count',
            };

            const dis = evaluateSourceLinkedDisagreement({
              disagreementId: 'prop-dis',
              indicatorKey: 'test-indicator',
              disagreementType: 'prediction_vs_observation',
              expectedMetric: 'expected',
              expectedVariableLink: {
                source_id: 'src',
                variable_id: 'v1',
                metric_id: 'm1',
                vintage: '2026',
                attribution: 'attr',
              },
              expectedDescription: 'Expected metric',
              expectedEstimate,
              expectedProvenance: mockProvenance,
              observedMetric: 'observed',
              observedVariableLink: {
                source_id: 'src',
                variable_id: 'v2',
                metric_id: 'm2',
                vintage: '2026',
                attribution: 'attr',
              },
              observedDescription: 'Observed metric',
              observedEstimate,
              observedProvenance: mockProvenance,
            });

            expect(dis).not.toBeNull();
            expect(dis?.resolution_state).toBe('unresolved_preserved');
            expect(dis?.severity === 'warning' || dis?.severity === 'critical').toBe(true);
            expect(dis?.expected_signal.estimate).toEqual(expectedEstimate);
            expect(dis?.observed_signal.estimate).toEqual(observedEstimate);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('proves zero-coercion invariant: suppressed data never converts to numeric 0', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('disclosure_avoidance' as const, 'small_sample' as const),
          fc.string({ minLength: 5, maxLength: 50 }),
          (reason, detail) => {
            const suppressedEstimate: EconomicEstimate = {
              status: 'suppressed',
              reason,
              detail,
            };

            const suppressedCbp: EconomicEvidenceRecord[] = [
              {
                evidence_id: 'ev-cbp-suppressed',
                source_id: 'census-cbp-zbp',
                metric_id: 'establishment-count',
                variable_name: 'ESTAB',
                label: 'Establishments',
                geography: mockGeographyTravis,
                estimate: suppressedEstimate,
                provenance: mockProvenance,
              },
            ];

            const result = analyzeMarketContext(
              {
                tenant_id: 'tenant-zero-coercion',
                target_geography: mockGeographyTravis,
                acs_evidence: [],
                cbp_evidence: suppressedCbp,
              },
              mockClockTimestamp
            );

            expect(result.business_activity.total_establishments.status).toBe('suppressed');
            expect('value' in result.business_activity.total_establishments).toBe(false);
            expect(result.derived_metrics.population_per_establishment.status).toBe('suppressed');
            expect('value' in result.derived_metrics.population_per_establishment).toBe(false);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('proves pure deterministic repeatability: identical inputs yield identical outputs', () => {
      const input = {
        tenant_id: 'tenant-determ',
        target_geography: mockGeographyTravis,
        acs_evidence: [],
        cbp_evidence: [],
      };
      const run1 = analyzeMarketContext(input, mockClockTimestamp);
      const run2 = analyzeMarketContext(input, mockClockTimestamp);
      expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
    });
  });
});
