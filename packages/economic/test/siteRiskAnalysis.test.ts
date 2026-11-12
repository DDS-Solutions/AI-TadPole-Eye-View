import {
  DOT_BTS_BASE_URL,
  DOT_BTS_DATA_HORIZON,
  DOT_BTS_SCREENING_DISCLAIMER,
  type DataProvenance,
  type DotBtsAccessibilityRecord,
  EPA_AQS_BASE_URL,
  EPA_AQS_DATA_CLASSIFICATION,
  EPA_AQS_HISTORICAL_DISCLAIMER,
  type EconomicEvidenceRecord,
  type EpaAqsQueryResult,
  FEMA_NFHL_ADVISORY_DISCLAIMER,
  type FemaNfhlSummary,
  SITE_RISK_SCREENING_DISCLAIMER,
  USGS_3DEP_ADVISORY_DISCLAIMER,
  USGS_3DEP_MODERN_EPQS_URL,
  type Usgs3DepElevationPointResult,
} from '@gev/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  classifyDotBtsAccessibilityTier,
  classifyDotBtsFreightExposure,
  parseDotBtsMeasurement,
  validateDotBtsEndpoint,
  validateDotBtsGeography,
} from '../src/dotBtsDictionary.js';
import { assessSiteRisk } from '../src/siteRiskAnalysis.js';
import { ECONOMIC_SOURCE_REGISTRY } from '../src/sourceRegistry.js';

function makeProvenance(
  providerId: string,
  feedId: string,
  name: string,
  url: string
): DataProvenance {
  return {
    schema_version: 1,
    source: {
      provider_id: providerId,
      feed_id: feedId,
      name,
      canonical_url: url,
    },
    retrieved_at: '2026-11-12T12:00:00.000Z',
    observation_period: {
      status: 'available',
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-12-31T23:59:59.000Z',
    },
    vintage: { status: 'available', value: '2024' },
    mode: 'seed',
    source_mode: 'seed',
    license: {
      id: 'us-government-public-domain',
      name: 'U.S. Government Work - 17 U.S.C. 105 (Public Domain)',
    },
    attribution: name,
    fixture_id: 'test-fixture-v1',
    cache: null,
    freshness: { status: 'fresh', age_seconds: 0, fresh_for_seconds: 86400 },
  };
}

describe('DOT/BTS Accessibility & Pure Site-Risk Engine (PLAN.md §10 Task 11.4 & ADR 0065)', () => {
  const travisGeo = {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  };

  it('validates DOT/BTS endpoints, geographies, and zero-coercion measurements', () => {
    expect(() => validateDotBtsEndpoint('https://data.bts.gov/resource')).not.toThrow();
    expect(() => validateDotBtsEndpoint('http://data.bts.gov/resource')).toThrow(/HTTPS/);
    expect(() => validateDotBtsGeography(travisGeo)).not.toThrow();
    expect(() => validateDotBtsGeography({ level: 'zcta', zcta: '78701' })).toThrow(
      /DOT\/BTS accessibility supports geographies/
    );

    expect(parseDotBtsMeasurement(0, 'km', false).status).toBe('unavailable');
    expect(parseDotBtsMeasurement(null, 'km', true).status).toBe('unavailable');
    expect(parseDotBtsMeasurement(-0.5, 'km', true).status).toBe('unavailable');

    const adjacent = parseDotBtsMeasurement(0, 'km', true);
    expect(adjacent.status).toBe('available');
    if (adjacent.status === 'available') expect(adjacent.value).toBe(0);

    const unavail = { status: 'unavailable' as const, reason: 'missing' };
    expect(classifyDotBtsAccessibilityTier(unavail, unavail, unavail)).toBe('unavailable');
    expect(classifyDotBtsFreightExposure(unavail)).toBe('unavailable');
  });

  it('returns insufficient_data and unavailable score when all hazard inputs are absent', () => {
    const result = assessSiteRisk({
      geography: travisGeo,
      isoTimestamp: '2026-11-12T12:00:00.000Z',
    });

    expect(result.screening_tier).toBe('insufficient_data');
    expect(result.overall_screening_score.status).toBe('unavailable');
    expect(result.long_term_hazards.available_signal_count).toBe(0);
    expect(result.accessibility_context.accessibility_tier).toBe('unavailable');
    expect(result.is_definitive_advice).toBe(false);
    expect(result.advisory_disclaimer).toBe(SITE_RISK_SCREENING_DISCLAIMER);
    expect(result.data_gaps.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps current operational alerts strictly separate from long-term hazard scores', () => {
    const nriRecord: EconomicEvidenceRecord = {
      evidence_id: 'nri-48453-score',
      source_id: 'fema-nri-nfhl',
      geography: travisGeo,
      variable_name: 'RISK_SCORE',
      metric_id: 'nri-composite-risk-score',
      estimate: {
        status: 'available',
        value: 25.0,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'index_score',
        notes: 'Relatively Low',
      },
      provenance: makeProvenance(
        'fema-nri-nfhl',
        'nri-composite',
        'FEMA National Risk Index (NRI)',
        'https://www.fema.gov/api/open/v1/NationalRiskIndex'
      ),
    };

    const withoutAlerts = assessSiteRisk({
      geography: travisGeo,
      isoTimestamp: '2026-11-12T12:00:00.000Z',
      femaNriRecords: [nriRecord],
    });

    const withExtremeAlert = assessSiteRisk({
      geography: travisGeo,
      isoTimestamp: '2026-11-12T12:00:00.000Z',
      femaNriRecords: [nriRecord],
      currentAlerts: [
        {
          id: 'nws-1',
          event: 'Flash Flood Warning',
          severity: 'Extreme',
          headline: 'Flash Flood Warning issued for Travis County',
        },
      ],
    });

    // Long-term score and tier must be invariant to transient current alerts
    expect(withExtremeAlert.overall_screening_score).toEqual(withoutAlerts.overall_screening_score);
    expect(withExtremeAlert.screening_tier).toBe(withoutAlerts.screening_tier);
    expect(withExtremeAlert.long_term_hazards).toEqual(withoutAlerts.long_term_hazards);

    // Current operational alerts are preserved separately
    expect(withoutAlerts.current_operational_alerts.active_alert_count).toBe(0);
    expect(withExtremeAlert.current_operational_alerts.active_alert_count).toBe(1);
    expect(withExtremeAlert.current_operational_alerts.highest_severity).toBe('Extreme');
    expect(withExtremeAlert.current_operational_alerts.horizon).toBe('current_operational_alert');
    expect(withExtremeAlert.long_term_hazards.horizon).toBe('long_term_structural_hazard');
  });

  it('synthesizes FEMA NRI/NFHL, USGS 3DEP, EPA AQS, and DOT/BTS with explicit provenance and gaps', () => {
    const nriRecord: EconomicEvidenceRecord = {
      evidence_id: 'nri-06037-score',
      source_id: 'fema-nri-nfhl',
      geography: travisGeo,
      variable_name: 'RISK_SCORE',
      metric_id: 'nri-composite-risk-score',
      estimate: {
        status: 'available',
        value: 72.5,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'index_score',
        notes: 'Relatively High',
      },
      provenance: makeProvenance(
        'fema-nri-nfhl',
        'nri-composite',
        'FEMA National Risk Index',
        'https://www.fema.gov/api/open/v1/NationalRiskIndex'
      ),
    };

    const nfhlSummary: FemaNfhlSummary = {
      geography: travisGeo,
      dominant_zone: 'AE',
      risk_category: 'high_risk_sfha',
      in_sfha: true,
      has_floodway: true,
      base_flood_elevation: {
        status: 'available',
        value: 142.5,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'feet_NAVD88',
      },
      vertical_datum: 'NAVD88',
      feature_count: 3,
      provenance: makeProvenance(
        'fema-nri-nfhl',
        'nfhl-flood',
        'FEMA National Flood Hazard Layer',
        'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer'
      ),
      advisory_disclaimer: FEMA_NFHL_ADVISORY_DISCLAIMER,
    };

    const usgsElev: Usgs3DepElevationPointResult = {
      point: { x: -97.7431, y: 30.2672 },
      elevation: {
        status: 'available',
        value: 149.0,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Meters',
      },
      elevation_meters: {
        status: 'available',
        value: 149.0,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Meters',
      },
      elevation_feet: {
        status: 'available',
        value: 488.84,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Feet',
      },
      data_source: '3DEP 1/3 arc-second',
      vertical_datum: 'NAVD88',
      horizontal_datum: 'NAD83',
      query_units: 'Meters',
      is_off_coverage: false,
      provenance: makeProvenance(
        'usgs-3dep',
        'elevation-epqs',
        'USGS EPQS',
        USGS_3DEP_MODERN_EPQS_URL
      ),
      advisory_disclaimer: USGS_3DEP_ADVISORY_DISCLAIMER,
    };

    const epaAqs: EpaAqsQueryResult = {
      geography: travisGeo,
      data_classification: EPA_AQS_DATA_CLASSIFICATION,
      is_real_time: false,
      sites: [],
      summaries: [],
      pollutant_coverage: [
        {
          pollutant_symbol: 'PM2.5',
          parameter_code: '88101',
          is_monitored: true,
          site_count: 1,
          summary_count: 1,
          latest_arithmetic_mean: {
            status: 'available',
            value: 11.4,
            margin_of_error: null,
            confidence_level: null,
            sample_size: 350,
            unit: 'ug/m3',
          },
          data_classification: EPA_AQS_DATA_CLASSIFICATION,
          is_real_time: false,
        },
        {
          pollutant_symbol: 'SO2',
          parameter_code: '42401',
          is_monitored: false,
          site_count: 0,
          summary_count: 0,
          latest_arithmetic_mean: { status: 'unavailable', reason: 'Unmonitored' },
          data_classification: EPA_AQS_DATA_CLASSIFICATION,
          is_real_time: false,
        },
      ],
      provenance: makeProvenance('epa-aqs', 'historical-monitoring', 'EPA AQS', EPA_AQS_BASE_URL),
      advisory_disclaimer: EPA_AQS_HISTORICAL_DISCLAIMER,
    };

    const dotBts: DotBtsAccessibilityRecord = {
      geography: travisGeo,
      nearest_interstate_km: {
        status: 'available',
        value: 1.4,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'km',
      },
      nearest_transit_stop_km: {
        status: 'available',
        value: 0.45,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'km',
      },
      transit_stops_within_1km: {
        status: 'available',
        value: 8,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'count',
      },
      freight_corridor_distance_km: {
        status: 'available',
        value: 1.6,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'km',
      },
      walkable_road_density_km_per_sqkm: {
        status: 'available',
        value: 11.2,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'km/sqkm',
      },
      commute_mean_minutes: {
        status: 'available',
        value: 24.8,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'minutes',
      },
      accessibility_tier: 'high_access',
      freight_exposure: 'secondary_arterial',
      is_covered: true,
      data_horizon: DOT_BTS_DATA_HORIZON,
      provenance: makeProvenance(
        'dot-bts-access',
        'transportation-accessibility',
        'DOT/BTS',
        DOT_BTS_BASE_URL
      ),
      advisory_disclaimer: DOT_BTS_SCREENING_DISCLAIMER,
    };

    const result = assessSiteRisk({
      geography: travisGeo,
      isoTimestamp: '2026-11-12T12:00:00.000Z',
      femaNriRecords: [nriRecord],
      femaNfhlSummary: nfhlSummary,
      usgsElevation: usgsElev,
      epaAqsResult: epaAqs,
      dotBtsRecord: dotBts,
    });

    expect(result.screening_tier).toBe('elevated_screening_concern');
    expect(result.long_term_hazards.in_sfha).toBe(true);
    expect(result.long_term_hazards.historical_air_exceedance_flags).toHaveLength(1);
    expect(result.accessibility_context.accessibility_tier).toBe('high_access');
    expect(result.source_signals).toHaveLength(5);
    expect(result.data_gaps.some((g) => g.includes('SO2'))).toBe(true);
  });

  it('property test: DOT/BTS uncovered values never coerce to available and site-risk stays deterministic', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.double({ min: -50, max: 500, noNaN: true })
        ),
        (rawVal) => {
          expect(parseDotBtsMeasurement(rawVal, 'km', false).status).toBe('unavailable');
        }
      )
    );

    expect(ECONOMIC_SOURCE_REGISTRY['dot-bts-access'].status).toBe('seed');
    expect(ECONOMIC_SOURCE_REGISTRY['dot-bts-access'].seed_fixture_id).toBe('dot-bts-synthetic-v1');
  });
});
