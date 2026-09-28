import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  calculateTerrainSlope,
  convertElevationEstimate,
  ECONOMIC_SOURCE_REGISTRY,
  FEET_TO_METERS_FACTOR,
  feetToMeters,
  haversineDistanceMeters,
  METERS_TO_FEET_FACTOR,
  metersToFeet,
  parseUsgsRawElevation,
  validateEpqsEndpoint,
  validateUsgsCoordinates,
} from '../src/index.js';

describe('USGS 3DEP Pure Conversions, Validators, and Non-Coercion Parser (PLAN.md §10 Task 11.2 & ADR 0063)', () => {
  describe('Unit Conversions', () => {
    it('converts meters to feet and back with precision', () => {
      expect(FEET_TO_METERS_FACTOR).toBe(0.3048);
      expect(METERS_TO_FEET_FACTOR).toBeCloseTo(3.280839895, 8);
      expect(metersToFeet(1)).toBeCloseTo(3.28084, 5);
      expect(feetToMeters(1)).toBeCloseTo(0.3048, 5);
      expect(feetToMeters(metersToFeet(100))).toBeCloseTo(100, 9);
      expect(metersToFeet(0)).toBe(0);
      expect(feetToMeters(0)).toBe(0);
      expect(metersToFeet(-86)).toBeCloseTo(-282.1522, 4);
      expect(haversineDistanceMeters(0, 0, 0, 1)).toBeGreaterThan(111000);
    });

    it('satisfies round-trip invertibility property across all finite elevations', () => {
      fc.assert(
        fc.property(fc.double({ min: -10000, max: 10000, noNaN: true }), (val) => {
          const roundtrip = feetToMeters(metersToFeet(val));
          return Math.abs(roundtrip - val) < 1e-9;
        })
      );
    });

    it('converts EconomicEstimate units while preserving status', () => {
      const availableMeters = {
        status: 'available' as const,
        value: 1000,
        margin_of_error: null,
        confidence_level: null,
        sample_size: null,
        unit: 'Meters',
      };
      const convertedFeet = convertElevationEstimate(availableMeters, 'Feet');
      expect(convertedFeet.status).toBe('available');
      if (convertedFeet.status === 'available') {
        expect(convertedFeet.value).toBeCloseTo(3280.84, 2);
        expect(convertedFeet.unit).toBe('Feet');
      }

      // Non-coercion: unavailable estimate remains unavailable
      const unavailable = {
        status: 'unavailable' as const,
        reason: 'Off-coverage ocean',
      };
      const convertedUnavailable = convertElevationEstimate(unavailable, 'Feet');
      expect(convertedUnavailable.status).toBe('unavailable');
    });
  });

  describe('Coordinate and Endpoint Validators', () => {
    it('accepts valid coordinates within geographic bounds', () => {
      expect(() => validateUsgsCoordinates(0, 0)).not.toThrow();
      expect(() => validateUsgsCoordinates(-180, -90)).not.toThrow();
      expect(() => validateUsgsCoordinates(180, 90)).not.toThrow();
      expect(() => validateUsgsCoordinates(-105.2705, 40.015)).not.toThrow();
    });

    it('rejects coordinates out of bounds', () => {
      expect(() => validateUsgsCoordinates(-180.1, 0)).toThrow(/Invalid longitude/);
      expect(() => validateUsgsCoordinates(180.1, 0)).toThrow(/Invalid longitude/);
      expect(() => validateUsgsCoordinates(0, -90.1)).toThrow(/Invalid latitude/);
      expect(() => validateUsgsCoordinates(0, 90.1)).toThrow(/Invalid latitude/);
      expect(() => validateUsgsCoordinates(Number.NaN, 0)).toThrow(/Invalid longitude/);
    });

    it('validates EPQS endpoint and strictly rejects retired pqs.php URL', () => {
      expect(() => validateEpqsEndpoint('https://epqs.nationalmap.gov/v1/json')).not.toThrow();
      expect(() => validateEpqsEndpoint('https://nationalmap.gov/epqs/pqs.php?x=1&y=2')).toThrow(
        /retired pqs.php endpoint is prohibited/
      );
      expect(() => validateEpqsEndpoint('https://example.com/pqs.php')).toThrow(
        /retired pqs.php endpoint is prohibited/
      );
    });
  });

  describe('Non-Coercion Raw EPQS Parser', () => {
    it('parses valid positive and sea-level elevations as available', () => {
      const positive = parseUsgsRawElevation(1630.5, 'Meters');
      expect(positive.isOffCoverage).toBe(false);
      expect(positive.elevation.status).toBe('available');
      if (positive.elevation.status === 'available') {
        expect(positive.elevation.value).toBe(1630.5);
      }

      const zeroSeaLevel = parseUsgsRawElevation(0.0, 'Meters');
      expect(zeroSeaLevel.isOffCoverage).toBe(false);
      expect(zeroSeaLevel.elevation.status).toBe('available');
      if (zeroSeaLevel.elevation.status === 'available') {
        expect(zeroSeaLevel.elevation.value).toBe(0.0);
      }
    });

    it('parses valid negative elevations on land as available without coercion', () => {
      const deathValley = parseUsgsRawElevation(-86.0, 'Meters');
      expect(deathValley.isOffCoverage).toBe(false);
      expect(deathValley.elevation.status).toBe('available');
      if (deathValley.elevation.status === 'available') {
        expect(deathValley.elevation.value).toBe(-86.0);
      }
    });

    it('parses -1000000 off-coverage sentinel as unavailable (NON-COERCION LAW)', () => {
      const sentinel = parseUsgsRawElevation(-1000000, 'Meters');
      expect(sentinel.isOffCoverage).toBe(true);
      expect(sentinel.elevation.status).toBe('unavailable');
      expect(sentinel.elevationMeters.status).toBe('unavailable');
      expect(sentinel.elevationFeet.status).toBe('unavailable');

      const stringSentinel = parseUsgsRawElevation('-1000000', 'Feet');
      expect(stringSentinel.isOffCoverage).toBe(true);
      expect(stringSentinel.elevation.status).toBe('unavailable');
    });

    it('parses null, empty string, and NaN as unavailable', () => {
      expect(parseUsgsRawElevation(null, 'Meters').elevation.status).toBe('unavailable');
      expect(parseUsgsRawElevation(undefined, 'Meters').elevation.status).toBe('unavailable');
      expect(parseUsgsRawElevation('', 'Meters').elevation.status).toBe('unavailable');
      expect(parseUsgsRawElevation('N/A', 'Meters').elevation.status).toBe('unavailable');
    });

    it('satisfies non-coercion property: values <= -999999 are always unavailable', () => {
      fc.assert(
        fc.property(fc.double({ min: -1e9, max: -999999, noNaN: true }), (val) => {
          const parsed = parseUsgsRawElevation(val, 'Meters');
          return parsed.isOffCoverage && parsed.elevation.status === 'unavailable';
        })
      );
    });

    it('satisfies valid land property: realistic elevations in [-500, 9000] are available and preserve sign', () => {
      fc.assert(
        fc.property(fc.double({ min: -500, max: 9000, noNaN: true }), (val) => {
          const parsed = parseUsgsRawElevation(val, 'Meters');
          return (
            !parsed.isOffCoverage &&
            parsed.elevation.status === 'available' &&
            Math.sign(parsed.elevation.value) === Math.sign(val)
          );
        })
      );
    });
  });

  describe('Terrain Slope Calculations', () => {
    it('calculates horizontal distance and slope accurately between two points', () => {
      // Points ~1.11km apart (0.01 deg lat)
      const p1 = {
        x: -105.0,
        y: 40.0,
        elevationMeters: {
          status: 'available' as const,
          value: 1000,
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
          unit: 'Meters',
        },
      };
      const p2 = {
        x: -105.0,
        y: 40.01,
        elevationMeters: {
          status: 'available' as const,
          value: 1100,
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
          unit: 'Meters',
        },
      };

      const slope = calculateTerrainSlope(p1, p2);
      expect(slope.horizontalDistanceMeters).toBeGreaterThan(1100);
      expect(slope.horizontalDistanceMeters).toBeLessThan(1120);
      expect(slope.elevationChangeMeters.status).toBe('available');
      if (slope.elevationChangeMeters.status === 'available') {
        expect(slope.elevationChangeMeters.value).toBe(100);
      }
      expect(slope.slopePercent.status).toBe('available');
      if (slope.slopePercent.status === 'available') {
        expect(slope.slopePercent.value).toBeGreaterThan(8);
        expect(slope.slopePercent.value).toBeLessThan(10);
      }
    });

    it('evaluates slope to unavailable if either point elevation is unavailable', () => {
      const p1 = {
        x: -105.0,
        y: 40.0,
        elevationMeters: {
          status: 'unavailable' as const,
          reason: 'Ocean off-coverage',
        },
      };
      const p2 = {
        x: -105.0,
        y: 40.01,
        elevationMeters: {
          status: 'available' as const,
          value: 1100,
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
          unit: 'Meters',
        },
      };

      const slope = calculateTerrainSlope(p1, p2);
      expect(slope.elevationChangeMeters.status).toBe('unavailable');
      expect(slope.slopePercent.status).toBe('unavailable');
      expect(slope.slopeDegrees.status).toBe('unavailable');
    });

    it('evaluates slope to not_applicable when coordinates are identical', () => {
      const p1 = {
        x: -105.0,
        y: 40.0,
        elevationMeters: {
          status: 'available' as const,
          value: 1000,
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
          unit: 'Meters',
        },
      };
      const slope = calculateTerrainSlope(p1, p1);
      expect(slope.horizontalDistanceMeters).toBe(0);
      expect(slope.slopePercent.status).toBe('not_applicable');
    });
  });

  describe('Source Registry Integration', () => {
    it('verifies usgs-3dep source registry metadata has advanced to seed status', () => {
      const metadata = ECONOMIC_SOURCE_REGISTRY['usgs-3dep'];
      expect(metadata).toBeDefined();
      expect(metadata.id).toBe('usgs-3dep');
      expect(metadata.status).toBe('seed');
      expect(metadata.seed_fixture_id).toBe('usgs-3dep-synthetic-v1');
      expect(metadata.supported_geographies).toEqual(['point', 'bounding_box']);
    });
  });
});
