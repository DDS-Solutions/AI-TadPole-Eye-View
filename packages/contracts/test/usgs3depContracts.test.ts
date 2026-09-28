import { describe, expect, it } from 'vitest';
import {
  type DataProvenance,
  RawUsgsEpqsResponseSchema,
  USGS_3DEP_ADVISORY_DISCLAIMER,
  USGS_3DEP_DEFAULT_VINTAGE,
  USGS_3DEP_MODERN_EPQS_URL,
  USGS_3DEP_RETIRED_ENDPOINT_SUBSTRING,
  USGS_3DEP_SCHEMA_VERSION,
  USGS_EPQS_OFF_COVERAGE_SENTINEL,
  Usgs3DepElevationPointResultSchema,
  Usgs3DepElevationUnitSchema,
  Usgs3DepFixtureDatasetSchema,
  Usgs3DepPointFixtureSchema,
  Usgs3DepPointQuerySchema,
  Usgs3DepSlopeResultSchema,
  Usgs3DepVerticalDatumSchema,
} from '../src/index.js';

describe('USGS 3DEP Contracts (PLAN.md §10 Task 11.2 & ADR 0063)', () => {
  const dummyProvenance: DataProvenance = {
    schema_version: 1,
    source: {
      provider_id: 'usgs-3dep',
      feed_id: 'elevation-epqs',
      name: 'USGS Elevation Point Query Service (EPQS)',
      canonical_url: USGS_3DEP_MODERN_EPQS_URL,
    },
    retrieved_at: '2026-09-27T12:00:00.000Z',
    observation_period: {
      status: 'available',
      start: '2024-01-01T00:00:00.000Z',
      end: '2024-09-27T23:59:59.000Z',
    },
    vintage: {
      status: 'available',
      value: USGS_3DEP_DEFAULT_VINTAGE,
    },
    mode: 'seed',
    source_mode: 'seed',
    license: {
      id: 'us-government-public-domain',
      name: 'U.S. Government Work - 17 U.S.C. 105 (Public Domain)',
    },
    attribution: 'U.S. Geological Survey, 3D Elevation Program (3DEP)',
    fixture_id: 'usgs-3dep-synthetic-v1',
    cache: null,
    freshness: {
      status: 'fresh',
      age_seconds: 0,
      fresh_for_seconds: 2592000,
    },
  };

  it('validates USGS 3DEP constants and endpoint policies', () => {
    expect(USGS_3DEP_SCHEMA_VERSION).toBe(1);
    expect(USGS_3DEP_DEFAULT_VINTAGE).toBe('3DEP 1/3 arc-second (2024)');
    expect(USGS_3DEP_MODERN_EPQS_URL).toBe('https://epqs.nationalmap.gov/v1/json');
    expect(USGS_3DEP_RETIRED_ENDPOINT_SUBSTRING).toBe('pqs.php');
    expect(USGS_EPQS_OFF_COVERAGE_SENTINEL).toBe(-1000000);
    expect(USGS_3DEP_ADVISORY_DISCLAIMER).toContain('Elevation Point Query Service (EPQS)');
    expect(USGS_3DEP_ADVISORY_DISCLAIMER).toContain('does not replace licensed boundary');
  });

  it('validates vertical datum and elevation units schemas', () => {
    expect(Usgs3DepVerticalDatumSchema.parse('NAVD88')).toBe('NAVD88');
    expect(Usgs3DepVerticalDatumSchema.parse('NAD83')).toBe('NAD83');
    expect(Usgs3DepVerticalDatumSchema.parse('WGS84')).toBe('WGS84');
    expect(Usgs3DepVerticalDatumSchema.parse('local_mean_sea_level')).toBe('local_mean_sea_level');
    expect(Usgs3DepVerticalDatumSchema.parse('unknown')).toBe('unknown');
    expect(() => Usgs3DepVerticalDatumSchema.parse('INVALID_DATUM')).toThrow();

    expect(Usgs3DepElevationUnitSchema.parse('Meters')).toBe('Meters');
    expect(Usgs3DepElevationUnitSchema.parse('Feet')).toBe('Feet');
    expect(() => Usgs3DepElevationUnitSchema.parse('Yards')).toThrow();
  });

  it('validates raw EPQS wire schemas including stringified and negative values', () => {
    const rawWire = {
      USGS_Elevation_Point_Query_Service: {
        Elevation_Query: {
          x: -105.2705,
          y: 40.015,
          Data_Source: '3DEP 1/3 arc-second',
          Units: 'Meters',
          Elevation: 1630.5,
        },
      },
    };
    const parsed = RawUsgsEpqsResponseSchema.parse(rawWire);
    expect(parsed.USGS_Elevation_Point_Query_Service.Elevation_Query.Elevation).toBe(1630.5);

    const rawStringWire = {
      USGS_Elevation_Point_Query_Service: {
        Elevation_Query: {
          x: '-105.2705',
          y: '40.0150',
          Data_Source: '3DEP 1/3 arc-second',
          Units: 'Feet',
          Elevation: '-1000000',
        },
      },
    };
    const parsedString = RawUsgsEpqsResponseSchema.parse(rawStringWire);
    expect(parsedString.USGS_Elevation_Point_Query_Service.Elevation_Query.Elevation).toBe(
      '-1000000'
    );
  });

  it('validates point query schema bounds and defaults', () => {
    const validQuery = Usgs3DepPointQuerySchema.parse({
      x: -105.2705,
      y: 40.015,
    });
    expect(validQuery.units).toBe('Meters');

    expect(() =>
      Usgs3DepPointQuerySchema.parse({
        x: -181,
        y: 40,
      })
    ).toThrow();

    expect(() =>
      Usgs3DepPointQuerySchema.parse({
        x: -105,
        y: 95,
      })
    ).toThrow();
  });

  it('validates normalized elevation point result schema with non-coercion invariants', () => {
    // Valid land reading
    const validResult = Usgs3DepElevationPointResultSchema.parse({
      point: { x: -105.2705, y: 40.015 },
      elevation: {
        status: 'available',
        value: 1630.5,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Meters',
      },
      elevation_meters: {
        status: 'available',
        value: 1630.5,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Meters',
      },
      elevation_feet: {
        status: 'available',
        value: 5349.4,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Feet',
      },
      data_source: '3DEP 1/3 arc-second',
      vertical_datum: 'NAVD88',
      query_units: 'Meters',
      is_off_coverage: false,
      provenance: dummyProvenance,
      advisory_disclaimer: USGS_3DEP_ADVISORY_DISCLAIMER,
    });
    expect(validResult.elevation.status).toBe('available');

    // Valid negative elevation on land (Death Valley)
    const validNegative = Usgs3DepElevationPointResultSchema.parse({
      point: { x: -116.8258, y: 36.2503 },
      elevation: {
        status: 'available',
        value: -86.0,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Meters',
      },
      elevation_meters: {
        status: 'available',
        value: -86.0,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Meters',
      },
      elevation_feet: {
        status: 'available',
        value: -282.15,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Feet',
      },
      data_source: '3DEP 1/3 arc-second',
      vertical_datum: 'NAVD88',
      query_units: 'Meters',
      is_off_coverage: false,
      provenance: dummyProvenance,
      advisory_disclaimer: USGS_3DEP_ADVISORY_DISCLAIMER,
    });
    expect(validNegative.elevation.status).toBe('available');

    // Valid off-coverage reading
    const offCoverageResult = Usgs3DepElevationPointResultSchema.parse({
      point: { x: -70.0, y: 25.0 },
      elevation: {
        status: 'unavailable',
        reason: 'USGS 3DEP elevation unavailable: point is outside coverage area or water body',
      },
      elevation_meters: {
        status: 'unavailable',
        reason: 'USGS 3DEP elevation unavailable: point is outside coverage area or water body',
      },
      elevation_feet: {
        status: 'unavailable',
        reason: 'USGS 3DEP elevation unavailable: point is outside coverage area or water body',
      },
      data_source: 'Unavailable',
      vertical_datum: 'unknown',
      query_units: 'Meters',
      is_off_coverage: true,
      provenance: dummyProvenance,
      advisory_disclaimer: USGS_3DEP_ADVISORY_DISCLAIMER,
    });
    expect(offCoverageResult.is_off_coverage).toBe(true);

    // NON-COERCION LAW: off-coverage point cannot have status 'available'
    expect(() =>
      Usgs3DepElevationPointResultSchema.parse({
        point: { x: -70.0, y: 25.0 },
        elevation: {
          status: 'available',
          value: 0.0,
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
          unit: 'Meters',
        },
        elevation_meters: {
          status: 'available',
          value: 0.0,
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
          unit: 'Meters',
        },
        elevation_feet: {
          status: 'available',
          value: 0.0,
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
          unit: 'Feet',
        },
        data_source: 'Unavailable',
        vertical_datum: 'unknown',
        query_units: 'Meters',
        is_off_coverage: true,
        provenance: dummyProvenance,
        advisory_disclaimer: USGS_3DEP_ADVISORY_DISCLAIMER,
      })
    ).toThrow(/Non-coercion law: off-coverage elevation must evaluate to unavailable/);
  });

  it('validates slope result schema and disclaimer requirement', () => {
    const slope = Usgs3DepSlopeResultSchema.parse({
      start_point: { x: -105.27, y: 40.01 },
      end_point: { x: -105.28, y: 40.02 },
      horizontal_distance_meters: 1420.5,
      elevation_change_meters: {
        status: 'available',
        value: 120.0,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Meters',
      },
      slope_percent: {
        status: 'available',
        value: 8.45,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'percent',
      },
      slope_degrees: {
        status: 'available',
        value: 4.83,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'degrees',
      },
      provenance: dummyProvenance,
      advisory_disclaimer: USGS_3DEP_ADVISORY_DISCLAIMER,
    });
    expect(slope.horizontal_distance_meters).toBe(1420.5);
  });

  it('validates fixture dataset schema against synthetic structure', () => {
    const pointFixture = Usgs3DepPointFixtureSchema.parse({
      location_name: 'Boulder, CO',
      x: -105.2705,
      y: 40.015,
      elevation: {
        status: 'available',
        value: 1630.5,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Meters',
      },
      elevation_meters: {
        status: 'available',
        value: 1630.5,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Meters',
      },
      elevation_feet: {
        status: 'available',
        value: 5349.4,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Feet',
      },
      data_source: '3DEP 1/3 arc-second',
      units: 'Meters',
      vertical_datum: 'NAVD88',
      is_off_coverage: false,
    });
    expect(pointFixture.location_name).toBe('Boulder, CO');

    const dataset = Usgs3DepFixtureDatasetSchema.parse({
      schema_version: 1,
      fixture_id: 'usgs-3dep-synthetic-v1',
      source_id: 'usgs-3dep',
      title: 'USGS 3DEP Synthetic Seed Fixture',
      description: 'Synthetic dataset for EPQS testing',
      provenance: dummyProvenance,
      points: [pointFixture],
    });
    expect(dataset.points).toHaveLength(1);
  });
});
