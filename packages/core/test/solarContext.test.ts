import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  calculateSolarContextAt,
  classifySolarLight,
  solarElevationDegrees,
} from '../src/solarContext.js';

describe('deterministic solar context', () => {
  it('matches published seasonal reference instants within the documented approximation', () => {
    const equinox = calculateSolarContextAt(Date.parse('2024-03-20T12:00:00.000Z'));
    const juneSolstice = calculateSolarContextAt(Date.parse('2024-06-20T20:51:00.000Z'));
    const decemberSolstice = calculateSolarContextAt(Date.parse('2024-12-21T09:21:00.000Z'));

    expect(equinox.subsolar_point.latitude).toBeCloseTo(0.15, 1);
    expect(equinox.subsolar_point.longitude).toBeCloseTo(1.83, 1);
    expect(juneSolstice.subsolar_point.latitude).toBeCloseTo(23.44, 1);
    expect(decemberSolstice.subsolar_point.latitude).toBeCloseTo(-23.44, 1);
    expect(juneSolstice).toMatchObject({ north_pole: 'day', south_pole: 'night' });
    expect(decemberSolstice).toMatchObject({ north_pole: 'night', south_pole: 'day' });
  });

  it('constructs closed boundary samples at the exact twilight elevations', () => {
    const context = calculateSolarContextAt(Date.parse('2024-08-25T10:00:00.000Z'), 72);
    for (const boundary of context.boundaries) {
      const first = boundary.coordinates[0];
      const last = boundary.coordinates.at(-1);
      expect(last).toEqual(first);
      for (const point of boundary.coordinates) {
        expect(solarElevationDegrees(context.subsolar_point, point)).toBeCloseTo(
          boundary.solar_altitude_deg,
          8
        );
      }
    }
  });

  it('classifies the exact civil, nautical, astronomical, and night thresholds', () => {
    expect(classifySolarLight(0)).toBe('day');
    expect(classifySolarLight(-0.001)).toBe('civil_twilight');
    expect(classifySolarLight(-6)).toBe('civil_twilight');
    expect(classifySolarLight(-6.001)).toBe('nautical_twilight');
    expect(classifySolarLight(-12)).toBe('nautical_twilight');
    expect(classifySolarLight(-12.001)).toBe('astronomical_twilight');
    expect(classifySolarLight(-18)).toBe('astronomical_twilight');
    expect(classifySolarLight(-18.001)).toBe('night');
  });

  it('is finite and schema-safe across leap days and UTC rollovers without wall-clock reads', () => {
    const dateNow = vi.spyOn(Date, 'now');
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2000-01-01T00:00:00.000Z'),
          max: new Date('2035-12-31T23:59:59.999Z'),
          noInvalidDate: true,
        }),
        (instant) => {
          const context = calculateSolarContextAt(instant.getTime(), 72);
          expect(Number.isFinite(context.subsolar_point.longitude)).toBe(true);
          expect(Number.isFinite(context.subsolar_point.latitude)).toBe(true);
          expect(context.boundaries).toHaveLength(4);
        }
      ),
      { numRuns: 100 }
    );
    expect(dateNow).not.toHaveBeenCalled();
    dateNow.mockRestore();
  });
});
