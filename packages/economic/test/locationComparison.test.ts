import {
  type EconomicEvidenceRecord,
  type EconomicGeography,
  type OsmCommercialFootprintSummary,
} from '@gev/contracts';
import { describe, expect, it } from 'vitest';
import { compareLocations } from '../src/locationComparison.js';

describe('Location Comparison Engine & Benchmark (Task 9.4 & ADR 0058)', () => {
  const mockClockTimestamp = '2026-09-21T12:00:00.000Z';

  const mockGeographyTravis: EconomicGeography = {
    level: 'county',
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  };

  const mockGeographyWilliamson: EconomicGeography = {
    level: 'county',
    county_fips: '48491',
    state_fips: '48',
    name: 'Williamson County, TX',
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

  const mockAcsEvidence: EconomicEvidenceRecord[] = [
    {
      evidence_id: 'ev-pop-48453',
      source_id: 'census-acs',
      metric_id: 'total-population',
      variable_name: 'B01003_001E',
      label: 'Total Population',
      geography: mockGeographyTravis,
      estimate: {
        status: 'available',
        value: 1290188,
        margin_of_error: 0,
        confidence_level: 0.9,
        sample_size: null,
        unit: 'persons',
      },
      provenance: mockProvenance,
    },
    {
      evidence_id: 'ev-income-48453',
      source_id: 'census-acs',
      metric_id: 'median-household-income',
      variable_name: 'B19013_001E',
      label: 'Median Household Income',
      geography: mockGeographyTravis,
      estimate: {
        status: 'available',
        value: 92400,
        margin_of_error: 1500,
        confidence_level: 0.9,
        sample_size: null,
        unit: 'USD',
      },
      provenance: mockProvenance,
    },
  ];

  const mockCbpEvidence: EconomicEvidenceRecord[] = [
    {
      evidence_id: 'ev-estab-48453',
      source_id: 'census-cbp-zbp',
      metric_id: 'establishment-count',
      variable_name: 'ESTAB',
      label: 'Total Establishments',
      geography: mockGeographyTravis,
      estimate: {
        status: 'available',
        value: 38200,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'establishments',
      },
      provenance: mockProvenance,
    },
    {
      evidence_id: 'ev-emp-48453',
      source_id: 'census-cbp-zbp',
      metric_id: 'paid-employment',
      variable_name: 'EMP',
      label: 'Total Paid Employment',
      geography: mockGeographyTravis,
      estimate: {
        status: 'available',
        value: 650000,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'employees',
      },
      provenance: mockProvenance,
    },
  ];

  const mockOsmFootprint: OsmCommercialFootprintSummary = {
    total_features: 1540,
    category_counts: {
      food_and_beverage: 650,
      retail: 420,
      services: 230,
      office: 120,
      craft_industrial: 40,
      healthcare: 50,
      hospitality: 30,
      other_commercial: 0,
    },
    density_per_km2: 24.5,
    area_km2: 62.85,
    top_amenities: [{ tag: 'amenity=restaurant', count: 320 }],
  };

  it('compares multiple locations, calculates relative differentials and ranks', () => {
    const loc1 = {
      location_key: 'travis',
      label: 'Travis County',
      geography: mockGeographyTravis,
      acs_evidence: mockAcsEvidence,
      cbp_evidence: mockCbpEvidence,
      osm_footprint: mockOsmFootprint,
    };

    const loc2 = {
      location_key: 'williamson',
      label: 'Williamson County',
      geography: mockGeographyWilliamson,
      acs_evidence: [
        {
          ...mockAcsEvidence[0]!,
          geography: mockGeographyWilliamson,
          estimate: {
            status: 'available' as const,
            value: 650000,
            margin_of_error: 0,
            confidence_level: 0.9,
            sample_size: null,
            unit: 'persons',
          },
        },
        {
          ...mockAcsEvidence[1]!,
          geography: mockGeographyWilliamson,
          estimate: {
            status: 'available' as const,
            value: 105000,
            margin_of_error: 1200,
            confidence_level: 0.9,
            sample_size: null,
            unit: 'USD',
          },
        },
      ],
      cbp_evidence: [
        {
          ...mockCbpEvidence[0]!,
          geography: mockGeographyWilliamson,
          estimate: {
            status: 'available' as const,
            value: 18000,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'establishments',
          },
        },
        {
          ...mockCbpEvidence[1]!,
          geography: mockGeographyWilliamson,
          estimate: {
            status: 'available' as const,
            value: 280000,
            margin_of_error: null,
            confidence_level: null,
            sample_size: null,
            unit: 'employees',
          },
        },
      ],
      osm_footprint: {
        ...mockOsmFootprint,
        total_features: 800,
      },
    };

    const comparison = compareLocations(
      {
        tenant_id: 'tenant-demo',
        benchmark_location_key: 'travis',
        locations: [loc1, loc2],
        naics_code: '722511',
        industry_title: 'Full-Service Restaurants',
      },
      mockClockTimestamp
    );

    expect(comparison.locations.length).toBe(2);
    expect(comparison.benchmark_location_key).toBe('travis');

    // Verify population row
    const popRow = comparison.metrics.find((m) => m.metric_id === 'total-population');
    expect(popRow).toBeDefined();
    const travisPop = popRow?.values.find((v) => v.location_key === 'travis');
    const wilcoPop = popRow?.values.find((v) => v.location_key === 'williamson');
    expect(travisPop?.rank).toBe(1);
    expect(wilcoPop?.rank).toBe(2);
    expect(wilcoPop?.relative_to_benchmark_pct).toBeCloseTo(-49.6, 1);

    // Verify income row
    const incRow = comparison.metrics.find((m) => m.metric_id === 'median-household-income');
    expect(incRow).toBeDefined();
    const wilcoInc = incRow?.values.find((v) => v.location_key === 'williamson');
    expect(wilcoInc?.rank).toBe(1);
    expect(wilcoInc?.relative_to_benchmark_pct).toBeCloseTo(13.6, 1);

    // Verify specialization
    expect(comparison.specializations).toBeDefined();
    expect(comparison.specializations?.length).toBe(2);
  });

  describe('Performance Threshold (< 15ms p95 across 500 iterations)', () => {
    it('executes synthetic multi-source market comparison analysis under 15ms p95', () => {
      const iterations = 500;
      const latencies: number[] = [];

      const loc1 = {
        location_key: 'travis',
        label: 'Travis County',
        geography: mockGeographyTravis,
        acs_evidence: mockAcsEvidence,
        cbp_evidence: mockCbpEvidence,
        osm_footprint: mockOsmFootprint,
      };

      const loc2 = {
        location_key: 'williamson',
        label: 'Williamson County',
        geography: mockGeographyWilliamson,
        acs_evidence: mockAcsEvidence,
        cbp_evidence: mockCbpEvidence,
        osm_footprint: mockOsmFootprint,
      };

      // Warmup
      for (let i = 0; i < 20; i++) {
        compareLocations(
          {
            tenant_id: 'tenant-perf',
            locations: [loc1, loc2],
            naics_code: '722511',
          },
          mockClockTimestamp
        );
      }

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        compareLocations(
          {
            tenant_id: 'tenant-perf',
            locations: [loc1, loc2],
            naics_code: '722511',
          },
          mockClockTimestamp
        );
        const elapsed = performance.now() - start;
        latencies.push(elapsed);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(iterations * 0.5)]!;
      const p95 = latencies[Math.floor(iterations * 0.95)]!;
      const p99 = latencies[Math.floor(iterations * 0.99)]!;

      console.log(
        `[BENCHMARK] Multi-Source Location Comparison Latency (${iterations} iterations): p50=${p50.toFixed(
          3
        )}ms, p95=${p95.toFixed(3)}ms, p99=${p99.toFixed(3)}ms`
      );

      expect(p95).toBeLessThan(15.0);
    });
  });
});
