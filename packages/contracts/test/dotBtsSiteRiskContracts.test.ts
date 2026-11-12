import { describe, expect, it } from 'vitest';
import {
  DOT_BTS_BASE_URL,
  DOT_BTS_DATA_HORIZON,
  DOT_BTS_DEFAULT_VINTAGE,
  DOT_BTS_SCREENING_DISCLAIMER,
  type DataProvenance,
  DotBtsAccessibilityRecordSchema,
  DotBtsFixtureDatasetSchema,
  DotBtsQueryResultSchema,
  DotBtsQuerySchema,
  SITE_RISK_SCHEMA_VERSION,
  SITE_RISK_SCREENING_DISCLAIMER,
  SiteRiskAssessmentResultSchema,
} from '../src/index.js';

describe('DOT/BTS & Site-Risk Screening Contracts (PLAN.md §10 Task 11.4 & ADR 0065)', () => {
  const sampleProvenance: DataProvenance = {
    schema_version: 1,
    source: {
      provider_id: 'dot-bts-access',
      feed_id: 'transportation-accessibility',
      name: 'U.S. DOT / Bureau of Transportation Statistics (BTS)',
      canonical_url: DOT_BTS_BASE_URL,
    },
    retrieved_at: '2026-11-12T12:00:00.000Z',
    observation_period: {
      status: 'available',
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-12-31T23:59:59.000Z',
    },
    vintage: {
      status: 'available',
      value: DOT_BTS_DEFAULT_VINTAGE,
    },
    mode: 'seed',
    source_mode: 'seed',
    license: {
      id: 'us-government-public-domain',
      name: 'U.S. Government Work - 17 U.S.C. 105 (Public Domain)',
    },
    attribution: 'U.S. Department of Transportation, Bureau of Transportation Statistics',
    fixture_id: 'dot-bts-synthetic-v1',
    cache: null,
    freshness: {
      status: 'fresh',
      age_seconds: 0,
      fresh_for_seconds: 2592000,
    },
  };

  const unavailable = { status: 'unavailable' as const, reason: 'Uncovered geography' };

  it('validates DOT/BTS and Site-Risk constants and disclaimers', () => {
    expect(DOT_BTS_BASE_URL).toBe('https://data.bts.gov/resource');
    expect(DOT_BTS_DATA_HORIZON).toBe('structural_infrastructure_benchmark');
    expect(DOT_BTS_SCREENING_DISCLAIMER).toContain(
      'structural infrastructure screening signals only'
    );
    expect(SITE_RISK_SCHEMA_VERSION).toBe(1);
    expect(SITE_RISK_SCREENING_DISCLAIMER).toContain('NOT definitive');
    expect(SITE_RISK_SCREENING_DISCLAIMER).toContain(
      'strictly separate from long-term structural hazards'
    );
  });

  it('enforces non-coercion invariant on uncovered DOT/BTS records', () => {
    expect(() =>
      DotBtsAccessibilityRecordSchema.parse({
        geography: { level: 'county', county_fips: '02185', state_fips: '02' },
        nearest_interstate_km: {
          status: 'available',
          value: 0,
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
          unit: 'km',
        },
        nearest_transit_stop_km: unavailable,
        transit_stops_within_1km: unavailable,
        freight_corridor_distance_km: unavailable,
        walkable_road_density_km_per_sqkm: unavailable,
        commute_mean_minutes: unavailable,
        accessibility_tier: 'unavailable',
        freight_exposure: 'unavailable',
        is_covered: false,
        data_horizon: DOT_BTS_DATA_HORIZON,
        provenance: sampleProvenance,
        advisory_disclaimer: DOT_BTS_SCREENING_DISCLAIMER,
      })
    ).toThrow(/Non-coercion law/);

    const validUncovered = DotBtsAccessibilityRecordSchema.parse({
      geography: { level: 'county', county_fips: '02185', state_fips: '02' },
      nearest_interstate_km: unavailable,
      nearest_transit_stop_km: unavailable,
      transit_stops_within_1km: unavailable,
      freight_corridor_distance_km: unavailable,
      walkable_road_density_km_per_sqkm: unavailable,
      commute_mean_minutes: unavailable,
      accessibility_tier: 'unavailable',
      freight_exposure: 'unavailable',
      is_covered: false,
      data_horizon: DOT_BTS_DATA_HORIZON,
      provenance: sampleProvenance,
      advisory_disclaimer: DOT_BTS_SCREENING_DISCLAIMER,
    });
    expect(validUncovered.is_covered).toBe(false);

    const fixture = DotBtsFixtureDatasetSchema.parse({
      schema_version: 1,
      fixture_id: 'dot-bts-synthetic-v1',
      source_id: 'dot-bts-access',
      title: 'Test DOT/BTS Fixture',
      description: 'Test fixture',
      data_horizon: DOT_BTS_DATA_HORIZON,
      provenance: sampleProvenance,
      records: [validUncovered],
    });
    expect(fixture.records).toHaveLength(1);

    const queryResult = DotBtsQueryResultSchema.parse({
      geography: { level: 'county', county_fips: '02185', state_fips: '02' },
      data_horizon: DOT_BTS_DATA_HORIZON,
      records: [validUncovered],
      provenance: sampleProvenance,
      advisory_disclaimer: DOT_BTS_SCREENING_DISCLAIMER,
    });
    expect(queryResult.records).toHaveLength(1);

    expect(
      DotBtsQuerySchema.parse({
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
      }).radius_km
    ).toBe(25);
  });

  it('enforces site-risk non-coercion when zero long-term hazard signals exist', () => {
    expect(() =>
      SiteRiskAssessmentResultSchema.parse({
        schema_version: 1,
        geography: { level: 'county', county_fips: '48453', state_fips: '48' },
        assessed_at: '2026-11-12T12:00:00.000Z',
        overall_screening_score: {
          status: 'available',
          value: 0,
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
          unit: 'screening_index_0_100',
        },
        screening_tier: 'low_screening_concern',
        long_term_hazards: {
          horizon: 'long_term_structural_hazard',
          fema_nri_composite_score: unavailable,
          fema_nri_rating: 'Insufficient Data',
          fema_nfhl_risk_category: 'unknown',
          in_sfha: null,
          elevation_meters: unavailable,
          terrain_slope_percent: unavailable,
          historical_air_exceedance_flags: [],
          available_signal_count: 0,
        },
        current_operational_alerts: {
          horizon: 'current_operational_alert',
          is_live_condition: true,
          active_alert_count: 0,
          highest_severity: 'None',
          alert_headlines: [],
          source_note: 'No active alerts',
        },
        accessibility_context: {
          accessibility_tier: 'unavailable',
          freight_exposure: 'unavailable',
          nearest_interstate_km: unavailable,
          nearest_transit_stop_km: unavailable,
          commute_mean_minutes: unavailable,
        },
        source_signals: [
          {
            source_id: 'fema-nri',
            product_name: 'FEMA NRI',
            vintage: 'Unavailable',
            geography: { level: 'county', county_fips: '48453', state_fips: '48' },
            mode: 'unavailable',
            status: 'unavailable',
          },
        ],
        data_gaps: ['All signals missing'],
        is_definitive_advice: false,
        provenance: sampleProvenance,
        advisory_disclaimer: SITE_RISK_SCREENING_DISCLAIMER,
      })
    ).toThrow(/Non-coercion law/);
  });
});
