import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  OverpassSanitizationError,
  assertOsmCommercialQueryWhitelisted,
  buildSanitizedOsmCommercialOverpassQuery,
  validateOsmCommercialBoundingBox,
} from '../src/index.js';

describe('OSM Commercial Overpass Sanitizer (PLAN.md §10 Task 9.3 & ADR 0021)', () => {
  it('validates and bounds commercial bounding box within 0.5° span limit', () => {
    const valid = {
      min_lat: 30.25,
      min_lon: -97.76,
      max_lat: 30.28,
      max_lon: -97.73,
    };
    expect(() => validateOsmCommercialBoundingBox(valid)).not.toThrow();

    // Inverted south/north
    expect(() =>
      validateOsmCommercialBoundingBox({
        min_lat: 30.28,
        min_lon: -97.76,
        max_lat: 30.25,
        max_lon: -97.73,
      })
    ).toThrow(/South latitude/);

    // Inverted west/east
    expect(() =>
      validateOsmCommercialBoundingBox({
        min_lat: 30.25,
        min_lon: -97.73,
        max_lat: 30.28,
        max_lon: -97.76,
      })
    ).toThrow(/West longitude/);

    // Exceeding 0.5° span cap
    expect(() =>
      validateOsmCommercialBoundingBox({
        min_lat: 30.0,
        min_lon: -97.0,
        max_lat: 30.55,
        max_lon: -96.9,
      })
    ).toThrow(/BBOX_AREA_EXCEEDED/);

    // Coordinate out of bounds
    expect(() =>
      validateOsmCommercialBoundingBox({
        min_lat: -95.0,
        min_lon: -97.0,
        max_lat: 30.0,
        max_lon: -96.0,
      })
    ).toThrow(/Latitude out of bounds/);
  });

  it('builds sanitized Overpass QL query restricted to whitelisted commercial categories', () => {
    const bbox = {
      min_lat: 30.25,
      min_lon: -97.76,
      max_lat: 30.28,
      max_lon: -97.73,
    };
    const res = buildSanitizedOsmCommercialOverpassQuery({
      bbox,
      categories: ['food_and_beverage', 'retail'],
      timeoutSec: 20,
    });

    expect(res.timeout_sec).toBe(20);
    expect(res.sanitized_ql).toContain('[out:json][timeout:20][bbox:30.25,-97.76,30.28,-97.73];');
    expect(res.sanitized_ql).toContain(
      'node["amenity"~"^(restaurant|cafe|bar|pub|fast_food|food_court|bistro|ice_cream)$"]'
    );
    expect(res.sanitized_ql).toContain('node["shop"]');
    expect(res.sanitized_ql).toContain('out center tags;');
    expect(res.complexity_score).toBeGreaterThan(0);
  });

  it('clamps timeout to maximum of 25 seconds', () => {
    const bbox = {
      min_lat: 30.25,
      min_lon: -97.76,
      max_lat: 30.28,
      max_lon: -97.73,
    };
    const res = buildSanitizedOsmCommercialOverpassQuery({
      bbox,
      timeoutSec: 999,
    });
    expect(res.timeout_sec).toBe(25);
  });

  it('asserts whitelisted commercial queries and rejects unwhitelisted arbitrary QL execution', () => {
    const whitelistedQl = `
      [out:json][timeout:25][bbox:30.25,-97.76,30.28,-97.73];
      (
        node["amenity"="cafe"](30.25,-97.76,30.28,-97.73);
        node["shop"="supermarket"](30.25,-97.76,30.28,-97.73);
      );
      out center tags;
    `;
    expect(() => assertOsmCommercialQueryWhitelisted(whitelistedQl)).not.toThrow();

    // Query targeting power infrastructure
    const powerQl = `
      [out:json][timeout:25][bbox:30.25,-97.76,30.28,-97.73];
      node["power"="substation"];
      out;
    `;
    expect(() => assertOsmCommercialQueryWhitelisted(powerQl)).toThrow(
      /UNWHITELISTED_COMMERCIAL_QUERY/
    );

    // Query targeting military facilities
    const militaryQl = `
      [out:json][timeout:25][bbox:30.25,-97.76,30.28,-97.73];
      node["military"="airfield"];
      out;
    `;
    expect(() => assertOsmCommercialQueryWhitelisted(militaryQl)).toThrow(
      /UNWHITELISTED_COMMERCIAL_QUERY/
    );

    // Query without any commercial keys
    const highwayQl = `
      [out:json][timeout:25][bbox:30.25,-97.76,30.28,-97.73];
      node["highway"="motorway"];
      out;
    `;
    expect(() => assertOsmCommercialQueryWhitelisted(highwayQl)).toThrow(
      /UNWHITELISTED_COMMERCIAL_QUERY/
    );
  });

  it('fast-check property test: rejects any bounding box exceeding 0.5° span', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -85, max: 85, noNaN: true }),
        fc.double({ min: -175, max: 175, noNaN: true }),
        fc.double({ min: 0.51, max: 2.0, noNaN: true }),
        (lat, lon, excessSpan) => {
          const bbox = {
            min_lat: lat,
            min_lon: lon,
            max_lat: Math.min(89, lat + excessSpan),
            max_lon: Math.min(179, lon + excessSpan),
          };
          if (bbox.max_lat - bbox.min_lat > 0.5 || bbox.max_lon - bbox.min_lon > 0.5) {
            expect(() => validateOsmCommercialBoundingBox(bbox)).toThrowError(
              OverpassSanitizationError
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
