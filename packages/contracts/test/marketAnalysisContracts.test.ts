import { describe, expect, it } from 'vitest';
import {
  CompetitionAnalysisInputSchema,
  CompetitionAnalysisResultSchema,
  DisagreementStateSchema,
  ECONOMIC_LEGAL_DISCLAIMER,
  ECONOMIC_SCHEMA_VERSION,
  HhiConcentrationResultSchema,
  LocationComparisonInputSchema,
  LocationComparisonResultSchema,
  MarketAnalysisInputSchema,
  MarketAnalysisResultSchema,
  SourceLinkedDisagreementSchema,
} from '../src/index.js';

describe('Market Analysis Contracts (PLAN.md §10 Task 9.4 & ADR 0058)', () => {
  const validProvenance = {
    schema_version: 1 as const,
    source: {
      provider_id: 'census-acs',
      feed_id: 'acs-5yr-profiles',
      name: 'U.S. Census Bureau ACS 5-Year Estimates',
      canonical_url: 'https://api.census.gov/data',
    },
    retrieved_at: '2026-09-16T12:00:00.000Z',
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

  const validGeography = {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  };

  const validEvidenceRecord = {
    evidence_id: 'ev-pop-48453',
    source_id: 'census-acs',
    metric_id: 'total-population',
    variable_name: 'B01003_001E',
    label: 'Total Population',
    geography: validGeography,
    estimate: {
      status: 'available' as const,
      value: 1290188,
      margin_of_error: 0,
      confidence_level: 0.9,
      sample_size: null,
      unit: 'persons',
    },
    provenance: validProvenance,
  };

  describe('SourceLinkedDisagreementSchema & DisagreementStateSchema', () => {
    it('validates a valid source-linked disagreement record', () => {
      const validDisagreement = {
        disagreement_id: 'dis-density-01',
        indicator_key: 'commercial_density',
        disagreement_type: 'prediction_vs_observation' as const,
        severity: 'warning' as const,
        expected_signal: {
          source_metric: 'model-benchmark-density',
          variable_link: {
            source_id: 'gev-economic-model',
            variable_id: 'BENCHMARK_DENSITY',
            metric_id: 'commercial-density-expectation',
            vintage: '2026-Q3-Benchmark',
            attribution: 'GEV Economic Model Benchmark',
          },
          description: 'Model expected commercial density benchmark',
          estimate: {
            status: 'available' as const,
            value: 20,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'poi_per_km2',
          },
          provenance: validProvenance,
        },
        observed_signal: {
          source_metric: 'osm-commercial-density',
          variable_link: {
            source_id: 'osm-commercial',
            variable_id: 'poi_density_km2',
            metric_id: 'commercial-density-per-km2',
            vintage: '2026-OSM-Extraction',
            attribution: '© OpenStreetMap contributors (ODbL 1.0)',
          },
          description: 'Observed commercial POI density per km²',
          estimate: {
            status: 'available' as const,
            value: 32,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'poi_per_km2',
          },
          provenance: validProvenance,
        },
        delta_metrics: {
          absolute_delta: 12,
          relative_delta_pct: 60,
          direction: 'observed_higher' as const,
        },
        resolution_state: 'unresolved_preserved' as const,
        delta_description: 'Observed value (32) is 60% higher than expected benchmark (20)',
      };

      const parsed = SourceLinkedDisagreementSchema.parse(validDisagreement);
      expect(parsed.resolution_state).toBe('unresolved_preserved');
      expect(parsed.severity).toBe('warning');

      const state = DisagreementStateSchema.parse({
        has_disagreements: true,
        total_disagreements: 1,
        by_severity: { info: 0, warning: 1, critical: 0 },
        records: [parsed],
      });
      expect(state.total_disagreements).toBe(1);
    });

    it('rejects disagreement with invalid resolution_state (must be unresolved_preserved)', () => {
      const invalid = {
        disagreement_id: 'dis-invalid',
        indicator_key: 'test',
        disagreement_type: 'prediction_vs_observation',
        severity: 'info',
        expected_signal: {
          source_metric: 'test',
          variable_link: {
            source_id: 'src',
            variable_id: 'v1',
            metric_id: 'm1',
            vintage: '2026',
            attribution: 'attr',
          },
          description: 'desc',
          estimate: {
            status: 'available',
            value: 10,
            unit: 'count',
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
          },
          provenance: validProvenance,
        },
        observed_signal: {
          source_metric: 'test',
          variable_link: {
            source_id: 'src',
            variable_id: 'v1',
            metric_id: 'm1',
            vintage: '2026',
            attribution: 'attr',
          },
          description: 'desc',
          estimate: {
            status: 'available',
            value: 20,
            unit: 'count',
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
          },
          provenance: validProvenance,
        },
        delta_metrics: {
          absolute_delta: 10,
          relative_delta_pct: 100,
          direction: 'observed_higher',
        },
        resolution_state: 'averaged_resolved', // FORBIDDEN
        delta_description: 'bad',
      };

      expect(() => SourceLinkedDisagreementSchema.parse(invalid)).toThrow();
    });
  });

  describe('HhiConcentrationResultSchema', () => {
    it('validates HHI score within 0 to 10,000 and valid tier', () => {
      const hhi = HhiConcentrationResultSchema.parse({
        hhi: 1850,
        tier: 'moderately_concentrated',
        firm_count: 5,
        top_share_pct: 35,
        cr4_pct: 85,
      });
      expect(hhi.tier).toBe('moderately_concentrated');
      expect(hhi.hhi).toBe(1850);
    });

    it('rejects HHI exceeding 10,000 or negative', () => {
      expect(() =>
        HhiConcentrationResultSchema.parse({
          hhi: 10500,
          tier: 'highly_concentrated',
          firm_count: 2,
          top_share_pct: 80,
        })
      ).toThrow();

      expect(() =>
        HhiConcentrationResultSchema.parse({
          hhi: -5,
          tier: 'unconcentrated',
          firm_count: 2,
          top_share_pct: 80,
        })
      ).toThrow();
    });
  });

  describe('MarketAnalysisInputSchema & MarketAnalysisResultSchema', () => {
    it('validates compliant MarketAnalysisInput', () => {
      const input = MarketAnalysisInputSchema.parse({
        tenant_id: 'tenant-demo',
        target_geography: validGeography,
        acs_evidence: [validEvidenceRecord],
        cbp_evidence: [
          {
            ...validEvidenceRecord,
            evidence_id: 'ev-cbp-01',
            source_id: 'census-cbp-zbp',
            metric_id: 'establishment-count',
            variable_name: 'ESTAB',
            label: 'Establishments',
            estimate: {
              status: 'available',
              value: 450,
              margin_of_error: null,
              confidence_level: null,
              sample_size: null,
              unit: 'establishments',
            },
          },
        ],
      });
      expect(input.tenant_id).toBe('tenant-demo');
    });

    it('validates compliant MarketAnalysisResult with mandatory disclaimer', () => {
      const result = MarketAnalysisResultSchema.parse({
        schema_version: ECONOMIC_SCHEMA_VERSION,
        analysis_id: 'mkt-travis-01',
        tenant_id: 'tenant-demo',
        target_geography: validGeography,
        analyzed_at: '2026-09-21T12:00:00.000Z',
        demographics: {
          total_population: validEvidenceRecord.estimate,
          median_household_income: {
            status: 'available',
            value: 85000,
            margin_of_error: 1200,
            confidence_level: 0.9,
            sample_size: null,
            unit: 'USD',
          },
          poverty_rate_pct: {
            status: 'available',
            value: 11.2,
            margin_of_error: 0.8,
            confidence_level: 0.9,
            sample_size: null,
            unit: 'percent',
          },
          bachelors_degree_rate_pct: {
            status: 'available',
            value: 48.5,
            margin_of_error: 1.1,
            confidence_level: 0.9,
            sample_size: null,
            unit: 'percent',
          },
        },
        business_activity: {
          total_establishments: {
            status: 'available',
            value: 35000,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'establishments',
          },
          paid_employment: {
            status: 'available',
            value: 450000,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'employees',
          },
          annual_payroll_usd_thousands: {
            status: 'available',
            value: 35000000,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'USD_thousands',
          },
          average_annual_wage_usd: {
            status: 'available',
            value: 77777.78,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'USD',
          },
        },
        commercial_footprint: {
          commercial_poi_count: {
            status: 'available',
            value: 1200,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'poi_count',
          },
          commercial_density_per_km2: {
            status: 'available',
            value: 15.5,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'poi_per_km2',
          },
          top_categories: [{ category: 'food_and_beverage', count: 450 }],
        },
        derived_metrics: {
          population_per_establishment: {
            status: 'available',
            value: 36.9,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'persons_per_establishment',
          },
          establishments_per_10k_residents: {
            status: 'available',
            value: 271.3,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'establishments_per_10k',
          },
          commercial_coverage_ratio: {
            status: 'available',
            value: 15.5,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'poi_per_km2',
          },
        },
        disagreement_state: {
          has_disagreements: false,
          total_disagreements: 0,
          by_severity: { info: 0, warning: 0, critical: 0 },
          records: [],
        },
        evidence_bundle: {
          bundle_id: 'bundle-travis-01',
          tenant_id: 'tenant-demo',
          title: 'Evidence Bundle',
          target_geography: validGeography,
          records: [validEvidenceRecord],
          created_at: '2026-09-21T12:00:00.000Z',
          provenance: validProvenance,
        },
        provenance: validProvenance,
        disclaimer: ECONOMIC_LEGAL_DISCLAIMER,
      });

      expect(result.disclaimer).toBe(ECONOMIC_LEGAL_DISCLAIMER);
      expect(result.schema_version).toBe(1);
    });
  });

  describe('CompetitionAnalysisInputSchema & LocationComparisonInputSchema', () => {
    it('validates CompetitionAnalysisInput with NAICS regex enforcement', () => {
      const comp = CompetitionAnalysisInputSchema.parse({
        tenant_id: 'tenant-demo',
        target_geography: validGeography,
        naics_code: '722511',
        industry_title: 'Full-Service Restaurants',
        cbp_evidence: [validEvidenceRecord],
        osm_poi_features: [
          {
            id: 101,
            type: 'node',
            lat: 30.2672,
            lon: -97.7431,
            name: 'Sample Bistro',
            category: 'food_and_beverage',
            primary_tag: 'amenity=restaurant',
            tags: { amenity: 'restaurant' },
          },
        ],
      });
      expect(comp.naics_code).toBe('722511');

      // Rejects invalid non-numeric NAICS
      expect(() =>
        CompetitionAnalysisInputSchema.parse({
          ...comp,
          naics_code: '72A511',
        })
      ).toThrow();
    });

    it('validates LocationComparisonInput enforcing 2 to 10 locations', () => {
      const locProfile = {
        location_key: 'travis-county',
        label: 'Travis County',
        geography: validGeography,
        acs_evidence: [validEvidenceRecord],
        cbp_evidence: [validEvidenceRecord],
      };

      // Fails with only 1 location
      expect(() =>
        LocationComparisonInputSchema.parse({
          tenant_id: 'tenant-demo',
          locations: [locProfile],
        })
      ).toThrow();

      // Succeeds with 2 locations
      const validCmp = LocationComparisonInputSchema.parse({
        tenant_id: 'tenant-demo',
        locations: [
          locProfile,
          {
            ...locProfile,
            location_key: 'williamson-county',
            label: 'Williamson County',
          },
        ],
      });
      expect(validCmp.locations.length).toBe(2);
    });
  });
});
