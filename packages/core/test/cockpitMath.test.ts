import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  fpmToMps,
  glideSlopeAngle,
  knotsToMps,
  machNumber,
  mpsToFpm,
  mpsToKnots,
  rateOfTurn,
  speedOfSound,
  turnRadius,
} from '../src/cockpitMath.js';

describe('Cockpit Math & Aviation Properties', () => {
  it('preserves unit conversion round-trips within precision limits', () => {
    fc.assert(
      fc.property(fc.double({ min: -5000, max: 5000, noNaN: true }), (fpm) => {
        const mps = fpmToMps(fpm);
        const back = mpsToFpm(mps);
        expect(Math.abs(fpm - back)).toBeLessThan(1e-6);
      })
    );

    fc.assert(
      fc.property(fc.double({ min: 0, max: 1000, noNaN: true }), (knots) => {
        const mps = knotsToMps(knots);
        const back = mpsToKnots(mps);
        expect(Math.abs(knots - back)).toBeLessThan(1e-6);
      })
    );
  });

  it('demonstrates ISA atmosphere monotonicity: speed of sound decreases with altitude up to tropopause', () => {
    const seaLevelSound = speedOfSound(0);
    const midAltSound = speedOfSound(5000);
    const tropopauseSound = speedOfSound(11000);

    expect(seaLevelSound).toBeGreaterThan(midAltSound);
    expect(midAltSound).toBeGreaterThan(tropopauseSound);

    // Consequently, for fixed True Airspeed, Mach number strictly increases with altitude
    const tas = 250; // m/s
    expect(machNumber(tas, 10000)).toBeGreaterThan(machNumber(tas, 0));
  });

  it('computes standard rate turn mechanics accurately and respects edge guards (P6)', () => {
    // Coordinated standard rate turn at 100 m/s ground speed
    const bankAngle = 15; // degrees
    const r = turnRadius(100, bankAngle);
    const rotRight = rateOfTurn(100, bankAngle);
    const rotLeft = rateOfTurn(100, -bankAngle);

    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(Number.POSITIVE_INFINITY);

    // Rate of turn preserves sign convention (positive right, negative left)
    expect(rotRight).toBeGreaterThan(0);
    expect(rotLeft).toBeLessThan(0);
    expect(rotRight).toBeCloseTo(-rotLeft, 6);

    // Bank angle >= 90 deg returns Infinity radius and does not invert sign
    expect(turnRadius(100, 90)).toBe(Number.POSITIVE_INFINITY);
    expect(turnRadius(100, 95)).toBe(Number.POSITIVE_INFINITY);
    expect(turnRadius(100, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(turnRadius(0, 30)).toBe(Number.POSITIVE_INFINITY);
  });

  it('calculates 3-degree glide slope descent rates accurately and returns sentinel for gs <= 0', () => {
    // 3 degree glide slope angle at 70 m/s (~136 knots) is roughly ~3.67 m/s (~720 fpm)
    const angle = glideSlopeAngle(3.67, 70);
    expect(angle).toBeCloseTo(3.0, 1);

    // Zero or negative groundspeed returns 0 sentinel
    expect(glideSlopeAngle(3.67, 0)).toBe(0);
    expect(glideSlopeAngle(3.67, -10)).toBe(0);
  });
});
