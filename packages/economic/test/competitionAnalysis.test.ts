import type {
  EconomicEvidenceRecord,
  EconomicGeography,
  OsmCommercialFootprintSummary,
  OsmCommercialPoiFeature,
} from '@gev/contracts';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { analyzeCompetition } from '../src/competitionAnalysis.js';

describe('Competition Analysis & Concentration Engine (Task 9.4 & ADR 0058)', () => {
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
      provider_id: 'census-cbp-zbp',
      feed_id: 'cbp-county-totals',
      name: 'U.S. Census Bureau CBP',
      canonical_url: 'https://api.census.gov/data',
    },
    retrieved_at: mockClockTimestamp,
    observation_period: {
      status: 'available' as const,
      start: '2023-01-01T00:00:00.000Z',
      end: '2023-12-31T23:59:59.000Z',
    },
    vintage: {
      status: 'available' as const,
      value: '2023 CBP',
    },
    mode: 'seed' as const,
    source_mode: 'seed' as const,
    license: {
      id: 'us-government-public-domain',
      name: 'U.S. Government Work (Public Domain)',
    },
    attribution: 'U.S. Census Bureau CBP',
    fixture_id: 'census-cbp-zbp-synthetic-v1',
    cache: null,
    freshness: {
      status: 'fresh' as const,
      age_seconds: 0,
      fresh_for_seconds: 86400,
    },
  };

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

  const mockOsmPoiFeatures: OsmCommercialPoiFeature[] = [
    {
      id: 1,
      type: 'node',
      lat: 30.267,
      lon: -97.743,
      name: 'Austin Bistro',
      category: 'food_and_beverage',
      primary_tag: 'amenity=restaurant',
      tags: { amenity: 'restaurant' },
    },
    {
      id: 2,
      type: 'node',
      lat: 30.268,
      lon: -97.744,
      name: 'Congress Grill',
      category: 'food_and_beverage',
      primary_tag: 'amenity=restaurant',
      tags: { amenity: 'restaurant' },
    },
    {
      id: 3,
      type: 'node',
      lat: 30.269,
      lon: -97.745,
      name: 'Zilker Cafe',
      category: 'food_and_beverage',
      primary_tag: 'amenity=restaurant',
      tags: { amenity: 'restaurant' },
    },
  ];

  it('computes HHI concentration, competitor density, and cross-source divergence', () => {
    const cbpRecord: EconomicEvidenceRecord = {
      evidence_id: 'ev-cbp-722511',
      source_id: 'census-cbp-zbp',
      metric_id: 'establishment-count',
      variable_name: 'ESTAB',
      label: 'Full-Service Restaurants (NAICS 722511)',
      geography: mockGeographyTravis,
      estimate: {
        status: 'available',
        value: 12,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'establishments',
      },
      provenance: mockProvenance,
    };

    const result = analyzeCompetition(
      {
        tenant_id: 'tenant-demo',
        target_geography: mockGeographyTravis,
        naics_code: '722511',
        industry_title: 'Full-Service Restaurants',
        cbp_evidence: [cbpRecord],
        osm_poi_features: mockOsmPoiFeatures,
        osm_footprint: mockOsmFootprint,
        firm_shares_or_sizes: [40, 30, 20, 10], // HHI: 1600 + 900 + 400 + 100 = 3000 (highly concentrated)
      },
      mockClockTimestamp
    );

    expect(result.concentration.hhi).toBe(3000);
    expect(result.concentration.tier).toBe('highly_concentrated');
    expect(result.concentration.top_share_pct).toBe(40);
    expect(result.observed_poi_competitors.status).toBe('available');
    if (result.observed_poi_competitors.status === 'available') {
      expect(result.observed_poi_competitors.value).toBe(3);
    }

    // Cross-source divergence: 12 reported vs 3 observed (75% lower)
    expect(result.disagreement_state.has_disagreements).toBe(true);
    const dis = result.disagreement_state.records.find(
      (r) => r.indicator_key === 'competitor_count_divergence'
    );
    expect(dis).toBeDefined();
    expect(dis?.severity).toBe('critical');
    expect(dis?.resolution_state).toBe('unresolved_preserved');
    expect(dis?.delta_description).toContain('75% lower');
  });

  describe('Fast-Check HHI Concentration Invariants', () => {
    it('proves HHI concentration invariants across arbitrary market shares', () => {
      fc.assert(
        fc.property(
          fc.array(fc.double({ min: 0.01, max: 100, noNaN: true }), {
            minLength: 1,
            maxLength: 50,
          }),
          (rawShares) => {
            const sum = rawShares.reduce((a, b) => a + b, 0);
            const normalizedShares = rawShares.map((s) => (s / sum) * 100);

            const result = analyzeCompetition(
              {
                tenant_id: 'tenant-prop',
                target_geography: mockGeographyTravis,
                naics_code: '541512',
                industry_title: 'Computer Systems Design',
                cbp_evidence: [],
                osm_poi_features: [],
                firm_shares_or_sizes: normalizedShares,
              },
              mockClockTimestamp
            );

            // Invariant: 0 <= HHI <= 10000
            expect(result.concentration.hhi).toBeGreaterThanOrEqual(0);
            expect(result.concentration.hhi).toBeLessThanOrEqual(10000);

            // Invariant: Top share <= 100%
            expect(result.concentration.top_share_pct).toBeGreaterThanOrEqual(0);
            expect(result.concentration.top_share_pct).toBeLessThanOrEqual(100);

            // Invariant: Tier consistency
            if (result.concentration.hhi > 2500) {
              expect(result.concentration.tier).toBe('highly_concentrated');
            } else if (result.concentration.hhi >= 1500) {
              expect(result.concentration.tier).toBe('moderately_concentrated');
            } else {
              expect(result.concentration.tier).toBe('unconcentrated');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
