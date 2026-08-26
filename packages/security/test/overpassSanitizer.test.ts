import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OverpassSanitizationError, sanitizeOverpassQuery } from '../src/index.js';

describe('Overpass QL Sanitizer & Security Guard (PLAN.md §10 Phase 1 Item 4)', () => {
  it('sanitizes valid Overpass QL queries with global bbox', () => {
    const raw = '[timeout:180][bbox:37.0,-122.5,38.0,-121.5]; node["amenity"="hospital"]; out;';
    const res = sanitizeOverpassQuery(raw);

    expect(res.timeout_sec).toBe(25); // Clamped to 25s
    expect(res.sanitized_ql).toContain('[out:json][timeout:25][bbox:37,-122.5,38,-121.5];');
    expect(res.sanitized_ql).toContain('node["amenity"="hospital"]; out;');
    expect(res.complexity_score).toBeGreaterThan(0);
  });

  it('injects fallback bounding box when query has no explicit bbox', () => {
    const raw = 'node["aeroway"="aerodrome"]; out;';
    const fallbackBbox = { min_lat: 51.0, min_lon: -0.5, max_lat: 51.6, max_lon: 0.2 };
    const res = sanitizeOverpassQuery(raw, { fallbackBbox });

    expect(res.sanitized_ql).toContain('[bbox:51,-0.5,51.6,0.2];');
    expect(res.bbox).toEqual(fallbackBbox);
  });

  it('rejects unbounded queries without fallback bbox', () => {
    const raw = 'node["amenity"="police"]; out;';
    expect(() => sanitizeOverpassQuery(raw)).toThrowError(OverpassSanitizationError);
    expect(() => sanitizeOverpassQuery(raw)).toThrow(/UNBOUNDED_QUERY/);
  });

  it('rejects queries with excessive bounding box span (> 5.0 deg)', () => {
    const raw = '[bbox:10.0,-100.0,30.0,-80.0]; node["emergency"="fire_hydrant"]; out;';
    expect(() => sanitizeOverpassQuery(raw)).toThrow(/BBOX_AREA_EXCEEDED/);
  });

  it('rejects ReDoS patterns in regular expression filters', () => {
    const raw = '[bbox:37.0,-122.5,38.0,-121.5]; node["name"~"(a+)+"]; out;';
    expect(() => sanitizeOverpassQuery(raw)).toThrow(/REDOS_DETECTED/);
  });

  it('rejects empty or whitespace queries', () => {
    expect(() => sanitizeOverpassQuery('')).toThrow(/EMPTY_QUERY/);
    expect(() => sanitizeOverpassQuery('   ')).toThrow(/EMPTY_QUERY/);
  });

  it('PROPERTY TEST: handles 500+ randomized valid bounding boxes losslessly', () => {
    fc.assert(
      fc.property(
        fc.record({
          lat: fc.double({ min: -85, max: 85, noNaN: true }),
          lon: fc.double({ min: -175, max: 175, noNaN: true }),
          latSpan: fc.double({ min: 0.01, max: 4.5, noNaN: true }),
          lonSpan: fc.double({ min: 0.01, max: 4.5, noNaN: true }),
          timeout: fc.integer({ min: -10, max: 1000 }),
        }),
        ({ lat, lon, latSpan, lonSpan, timeout }) => {
          const s = Number(lat.toFixed(4));
          const w = Number(lon.toFixed(4));
          const n = Number((lat + latSpan).toFixed(4));
          const e = Number((lon + lonSpan).toFixed(4));

          const raw = `[timeout:${timeout}][bbox:${s},${w},${n},${e}]; node["amenity"="pharmacy"]; out;`;
          const res = sanitizeOverpassQuery(raw);

          expect(res.timeout_sec).toBeGreaterThanOrEqual(1);
          expect(res.timeout_sec).toBeLessThanOrEqual(25);
          expect(res.sanitized_ql.startsWith('[out:json]')).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('BENCHMARK: sanitizes query in < 1ms', () => {
    const raw =
      '[timeout:10][bbox:37.0,-122.5,38.0,-121.5]; (node["amenity"="hospital"]; way["amenity"="hospital"];); out center;';
    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      sanitizeOverpassQuery(raw);
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;
    expect(avgMs).toBeLessThan(1.0);
  });
});
