import { describe, expect, it } from 'vitest';
import {
  FEMA_NFHL_ADVISORY_DISCLAIMER,
  FEMA_NFHL_DEFAULT_VINTAGE,
  FEMA_NFHL_SCHEMA_VERSION,
  FEMA_NRI_DEFAULT_VINTAGE,
  FEMA_NRI_SCHEMA_VERSION,
  FEMA_NRI_SCREENING_DISCLAIMER,
  FemaNfhlBoundingBoxSchema,
  FemaNfhlFloodHazardFeatureSchema,
  FemaNfhlFloodZoneSchema,
  FemaNfhlQuerySchema,
  FemaNfhlRiskCategorySchema,
  FemaNfhlSummarySchema,
  FemaNriHazardTypeSchema,
  FemaNriQuerySchema,
  FemaNriRiskRatingSchema,
  FemaNriVariableDefinitionSchema,
  FemaNriVariableDictionarySchema,
  FemaNriVariableIdSchema,
} from '../src/index.js';

describe('FEMA NRI & NFHL Contracts (PLAN.md §10 Task 11.1 & ADR 0062)', () => {
  it('validates FEMA NRI constants and risk rating classifications', () => {
    expect(FEMA_NRI_SCHEMA_VERSION).toBe(1);
    expect(FEMA_NRI_DEFAULT_VINTAGE).toBe('November 2023');
    expect(FEMA_NRI_SCREENING_DISCLAIMER).toContain(
      'planning, hazard mitigation, and preliminary screening'
    );
    expect(FEMA_NRI_SCREENING_DISCLAIMER).toContain(
      'do not replace site-specific geotechnical, structural, or hydrological studies'
    );

    expect(FemaNriRiskRatingSchema.parse('Very Low')).toBe('Very Low');
    expect(FemaNriRiskRatingSchema.parse('Relatively Low')).toBe('Relatively Low');
    expect(FemaNriRiskRatingSchema.parse('Relatively Moderate')).toBe('Relatively Moderate');
    expect(FemaNriRiskRatingSchema.parse('Relatively High')).toBe('Relatively High');
    expect(FemaNriRiskRatingSchema.parse('Very High')).toBe('Very High');
    expect(FemaNriRiskRatingSchema.parse('Not Applicable')).toBe('Not Applicable');
    expect(FemaNriRiskRatingSchema.parse('Insufficient Data')).toBe('Insufficient Data');
    expect(() => FemaNriRiskRatingSchema.parse('Extreme')).toThrow();
  });

  it('validates FEMA NRI hazard types and variable IDs', () => {
    expect(FemaNriHazardTypeSchema.parse('riverine_flooding')).toBe('riverine_flooding');
    expect(FemaNriHazardTypeSchema.parse('coastal_flooding')).toBe('coastal_flooding');
    expect(FemaNriHazardTypeSchema.parse('wildfire')).toBe('wildfire');
    expect(FemaNriHazardTypeSchema.parse('earthquake')).toBe('earthquake');
    expect(FemaNriHazardTypeSchema.parse('hurricane')).toBe('hurricane');
    expect(FemaNriHazardTypeSchema.parse('tornado')).toBe('tornado');
    expect(() => FemaNriHazardTypeSchema.parse('cyber_attack')).toThrow();

    expect(FemaNriVariableIdSchema.parse('RISK_SCORE')).toBe('RISK_SCORE');
    expect(FemaNriVariableIdSchema.parse('EAL_VALT')).toBe('EAL_VALT');
    expect(FemaNriVariableIdSchema.parse('SOVI_SCORE')).toBe('SOVI_SCORE');
    expect(FemaNriVariableIdSchema.parse('RESL_SCORE')).toBe('RESL_SCORE');
    expect(FemaNriVariableIdSchema.parse('RFLD_RISKS')).toBe('RFLD_RISKS');
    expect(FemaNriVariableIdSchema.parse('WDFR_RISKS')).toBe('WDFR_RISKS');
    expect(() => FemaNriVariableIdSchema.parse('UNKNOWN_METRIC')).toThrow();
  });

  it('validates FEMA NRI variable definitions and dictionary contracts', () => {
    const varDef = FemaNriVariableDefinitionSchema.parse({
      variable_id: 'RISK_SCORE',
      metric_id: 'nri-composite-risk-score',
      label: 'National Risk Index Composite Risk Score',
      description: 'Relative composite natural hazard risk score on a 0-100 scale.',
      unit: 'index_score',
      category: 'composite_risk',
      supported_geographies: ['county', 'tract'],
      tags: ['fema', 'nri', 'risk'],
    });
    expect(varDef.variable_id).toBe('RISK_SCORE');

    const dictionary = FemaNriVariableDictionarySchema.parse({
      schema_version: 1,
      version: '1.0.0',
      program: 'fema_nri',
      screening_disclaimer: FEMA_NRI_SCREENING_DISCLAIMER,
      vintages_supported: ['November 2023', 'August 2023'],
      variables: {
        RISK_SCORE: varDef,
      },
    });
    expect(dictionary.program).toBe('fema_nri');
    expect(dictionary.screening_disclaimer).toBe(FEMA_NRI_SCREENING_DISCLAIMER);
  });

  it('validates FEMA NRI query schema with geography bounds and unknown parameter rejection', () => {
    const validCountyQuery = FemaNriQuerySchema.parse({
      geography: {
        level: 'county',
        county_fips: '48453',
        state_fips: '48',
        name: 'Travis County, TX',
      },
      variables: ['RISK_SCORE', 'EAL_VALT'],
    });
    expect(validCountyQuery.geography.level).toBe('county');

    // Unsupported geography level (e.g. nation)
    expect(() =>
      FemaNriQuerySchema.parse({
        geography: {
          level: 'nation',
          country_code: 'US',
        },
      })
    ).toThrow(/FEMA NRI queries support geographies: county, tract, state/);

    // Unrecognized query parameter rejection
    expect(() =>
      FemaNriQuerySchema.parse({
        geography: {
          level: 'county',
          county_fips: '48453',
          state_fips: '48',
        },
        malicious_extra_field: 'exploit',
      })
    ).toThrow(/Unrecognized query parameter 'malicious_extra_field'/);
  });

  it('validates FEMA NFHL flood zones and risk category classifications', () => {
    expect(FEMA_NFHL_SCHEMA_VERSION).toBe(1);
    expect(FEMA_NFHL_DEFAULT_VINTAGE).toBe('NFHL Status Active (September 2024)');
    expect(FEMA_NFHL_ADVISORY_DISCLAIMER).toContain(
      'geospatial screening and flood hazard identification only'
    );
    expect(FEMA_NFHL_ADVISORY_DISCLAIMER).toContain(
      'do not constitute a formal Letter of Map Amendment (LOMA)'
    );

    // High risk SFHA zones
    expect(FemaNfhlFloodZoneSchema.parse('A')).toBe('A');
    expect(FemaNfhlFloodZoneSchema.parse('AE')).toBe('AE');
    expect(FemaNfhlFloodZoneSchema.parse('AH')).toBe('AH');
    expect(FemaNfhlFloodZoneSchema.parse('AO')).toBe('AO');
    expect(FemaNfhlFloodZoneSchema.parse('VE')).toBe('VE');

    // Moderate and minimal risk zones
    expect(FemaNfhlFloodZoneSchema.parse('B')).toBe('B');
    expect(FemaNfhlFloodZoneSchema.parse('C')).toBe('C');
    expect(FemaNfhlFloodZoneSchema.parse('X')).toBe('X');

    // Undetermined zone
    expect(FemaNfhlFloodZoneSchema.parse('D')).toBe('D');
    expect(() => FemaNfhlFloodZoneSchema.parse('ZONE_Z')).toThrow();

    expect(FemaNfhlRiskCategorySchema.parse('high_risk_sfha')).toBe('high_risk_sfha');
    expect(FemaNfhlRiskCategorySchema.parse('moderate_risk_500yr')).toBe('moderate_risk_500yr');
    expect(FemaNfhlRiskCategorySchema.parse('minimal_risk_outside_sfha')).toBe(
      'minimal_risk_outside_sfha'
    );
    expect(FemaNfhlRiskCategorySchema.parse('undetermined_risk_zone_d')).toBe(
      'undetermined_risk_zone_d'
    );
    expect(FemaNfhlRiskCategorySchema.parse('unknown')).toBe('unknown');
  });

  it('validates FEMA NFHL bounding box coordinates and ordering', () => {
    const validBbox = FemaNfhlBoundingBoxSchema.parse([-97.8, 30.2, -97.6, 30.4]);
    expect(validBbox).toEqual([-97.8, 30.2, -97.6, 30.4]);

    // min_lon > max_lon inverted
    expect(() => FemaNfhlBoundingBoxSchema.parse([-97.5, 30.2, -97.8, 30.4])).toThrow(
      /min_lon must not exceed max_lon/
    );

    // min_lat > max_lat inverted
    expect(() => FemaNfhlBoundingBoxSchema.parse([-97.8, 30.5, -97.6, 30.2])).toThrow(
      /min_lat must not exceed max_lat/
    );
  });

  it('validates FEMA NFHL flood hazard features with non-coerced estimates', () => {
    // Feature with available BFE
    const sfhaFeature = FemaNfhlFloodHazardFeatureSchema.parse({
      dfirm_id: '48453C',
      fld_ar_id: '48453C_001',
      fld_zone: 'AE',
      zone_subty: 'FLOODWAY',
      sfha_tf: true,
      static_bfe: {
        status: 'available',
        value: 482.5,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'feet',
        notes: 'Base Flood Elevation in feet NAVD88',
      },
      v_datum: 'NAVD88',
      depth: {
        status: 'not_applicable',
        reason: 'Depth only applicable in AO/AH sheet flow zones',
      },
      study_typ: 'NP Detailed Study with BFE',
      source_cit: 'DFIRM Panel 48453C0465H',
      bounding_box: [-97.75, 30.26, -97.74, 30.27],
    });
    expect(sfhaFeature.fld_zone).toBe('AE');
    expect(sfhaFeature.sfha_tf).toBe(true);
    expect(sfhaFeature.static_bfe.status).toBe('available');
    expect(sfhaFeature.depth.status).toBe('not_applicable');

    // Minimal risk feature with not-applicable BFE (strictly not coerced to 0)
    const minimalFeature = FemaNfhlFloodHazardFeatureSchema.parse({
      dfirm_id: '48453C',
      fld_ar_id: '48453C_002',
      fld_zone: 'X',
      zone_subty: 'AREA OF MINIMAL FLOOD HAZARD',
      sfha_tf: false,
      static_bfe: {
        status: 'not_applicable',
        reason: 'Base Flood Elevation is not defined for Zone X minimal flood hazard areas',
      },
      v_datum: null,
      depth: {
        status: 'not_applicable',
        reason: 'Depth not applicable outside flood hazard areas',
      },
    });
    expect(minimalFeature.fld_zone).toBe('X');
    expect(minimalFeature.sfha_tf).toBe(false);
    expect(minimalFeature.static_bfe.status).toBe('not_applicable');
  });

  it('validates FEMA NFHL flood summary and query schemas', () => {
    const summary = FemaNfhlSummarySchema.parse({
      geography: {
        level: 'county',
        county_fips: '48453',
        state_fips: '48',
        name: 'Travis County, TX',
      },
      dominant_zone: 'AE',
      risk_category: 'high_risk_sfha',
      in_sfha: true,
      has_floodway: true,
      base_flood_elevation: {
        status: 'available',
        value: 482.5,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'feet',
      },
      vertical_datum: 'NAVD88',
      feature_count: 4,
      provenance: {
        schema_version: 1,
        source: {
          provider_id: 'fema-nri-nfhl',
          feed_id: 'nfhl-flood-hazards',
          name: 'FEMA National Flood Hazard Layer',
          canonical_url: 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer',
        },
        retrieved_at: '2026-09-26T12:00:00.000Z',
        observation_period: {
          status: 'available',
          start: '2024-01-01T00:00:00.000Z',
          end: '2024-09-26T23:59:59.000Z',
        },
        vintage: {
          status: 'available',
          value: FEMA_NFHL_DEFAULT_VINTAGE,
        },
        mode: 'seed',
        source_mode: 'seed',
        license: {
          id: 'us-government-public-domain',
          name: 'U.S. Government Work - 17 U.S.C. 105 (Public Domain)',
        },
        attribution: 'Federal Emergency Management Agency (FEMA), National Flood Hazard Layer',
        fixture_id: 'fema-nfhl-synthetic-v1',
        cache: null,
        freshness: {
          status: 'fresh',
          age_seconds: 0,
          fresh_for_seconds: 2592000,
        },
      },
      advisory_disclaimer: FEMA_NFHL_ADVISORY_DISCLAIMER,
    });
    expect(summary.dominant_zone).toBe('AE');
    expect(summary.in_sfha).toBe(true);

    // Query with point
    const pointQuery = FemaNfhlQuerySchema.parse({
      point: { latitude: 30.2672, longitude: -97.7431 },
    });
    expect(pointQuery.point?.latitude).toBe(30.2672);

    // Query with bounding box
    const bboxQuery = FemaNfhlQuerySchema.parse({
      bounding_box: [-97.8, 30.2, -97.6, 30.4],
    });
    expect(bboxQuery.bounding_box).toBeDefined();

    // Query with empty object fails superRefine
    expect(() => FemaNfhlQuerySchema.parse({})).toThrow(
      /FEMA NFHL query must provide at least one of: geography, point, or bounding_box/
    );
  });
});
