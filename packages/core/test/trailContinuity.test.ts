import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRAIL_MAX_GAP_MS,
  type TrailFix,
  nauticalMilesBetween,
  segmentTrailFixes,
  trailPairBreakReason,
} from '../src/trailContinuity.js';

describe('Trail Continuity & Gap Splitting', () => {
  it('breaks tracks on non-advancing time, missing altitude, long gaps, and supersonic jumps', () => {
    const base: TrailFix = { lat: 37.6, lon: -122.3, altitudeM: 10_000, timeMs: 1_000_000 };

    expect(trailPairBreakReason(base, { ...base, timeMs: base.timeMs })).toBe('non_advancing_time');
    expect(
      trailPairBreakReason(base, {
        ...base,
        altitudeM: null,
        nullAltitude: true,
        timeMs: base.timeMs + 60_000,
      })
    ).toBe('null_altitude');
    expect(
      trailPairBreakReason(base, {
        lat: 38.0,
        lon: -122.0,
        altitudeM: 10_000,
        timeMs: base.timeMs + DEFAULT_TRAIL_MAX_GAP_MS + 1,
      })
    ).toBe('gap_exceeded');
    expect(
      trailPairBreakReason(base, {
        lat: 37.6,
        lon: -120.0,
        altitudeM: 10_000,
        timeMs: base.timeMs + 10_000,
      })
    ).toBe('excessive_speed');
  });

  it('keeps parked aircraft within 0.1 nm under 3 hours as one continuous segment', () => {
    const a: TrailFix = { lat: 37.6188, lon: -122.3754, altitudeM: 10, timeMs: 1_000_000 };
    const b: TrailFix = {
      lat: 37.6189,
      lon: -122.3753,
      altitudeM: 10,
      timeMs: 1_000_000 + 2 * 3_600_000,
    };
    expect(nauticalMilesBetween(a.lat, a.lon, b.lat, b.lon)).toBeLessThan(0.1);
    expect(trailPairBreakReason(a, b)).toBeNull();
    expect(segmentTrailFixes([b, a])).toHaveLength(1);
  });

  it('splits mixed-gap chronological sequences cleanly without dropping points', () => {
    const fixes: TrailFix[] = [
      { lat: 37.6, lon: -122.3, altitudeM: 9000, timeMs: 100_000 },
      { lat: 37.62, lon: -122.28, altitudeM: 9100, timeMs: 160_000 },
      {
        lat: 37.64,
        lon: -122.26,
        altitudeM: 9200,
        timeMs: 160_000 + DEFAULT_TRAIL_MAX_GAP_MS + 1000,
      },
      {
        lat: 37.66,
        lon: -122.24,
        altitudeM: 9300,
        timeMs: 220_000 + DEFAULT_TRAIL_MAX_GAP_MS + 1000,
      },
    ];
    const segments = segmentTrailFixes(fixes);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.fixes).toHaveLength(2);
    expect(segments[1]?.fixes).toHaveLength(2);
    expect(segments[1]?.breakReasonBefore).toBe('gap_exceeded');
  });

  it('property: great-circle distance is symmetric and non-negative, and every input fix is preserved', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -89, max: 89, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -89, max: 89, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (latA, lonA, latB, lonB) => {
          const d1 = nauticalMilesBetween(latA, lonA, latB, lonB);
          const d2 = nauticalMilesBetween(latB, lonB, latA, lonA);
          expect(d1).toBeGreaterThanOrEqual(0);
          expect(Math.abs(d1 - d2)).toBeLessThan(1e-6);
        }
      )
    );

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            lat: fc.double({ min: 30, max: 40, noNaN: true }),
            lon: fc.double({ min: -120, max: -110, noNaN: true }),
            altitudeM: fc.double({ min: 0, max: 15000, noNaN: true }),
            timeMs: fc.integer({ min: 0, max: 10_000_000 }),
          }),
          { minLength: 0, maxLength: 30 }
        ),
        (fixes) => {
          const segments = segmentTrailFixes(fixes);
          const totalCount = segments.reduce((sum, seg) => sum + seg.fixes.length, 0);
          expect(totalCount).toBe(fixes.length);
        }
      )
    );
  });
});
