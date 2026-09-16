import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  calculateProductMoe,
  calculateProportionMoe,
  calculateRatioMoe,
  calculateSumMoe,
  scaleMoeConfidence,
} from '../src/marginOfError.js';

describe('Statistical Margin of Error (MOE) Calculations', () => {
  describe('calculateSumMoe', () => {
    it('calculates exact sum for 3-4-5 right triangle', () => {
      expect(calculateSumMoe([3, 4])).toBe(5);
    });

    it('returns 0 for empty array', () => {
      expect(calculateSumMoe([])).toBe(0);
    });

    it('throws on negative or non-finite values', () => {
      expect(() => calculateSumMoe([1, -2, 3])).toThrow(/finite non-negative/);
      expect(() => calculateSumMoe([1, Number.NaN])).toThrow(/finite non-negative/);
    });

    it('satisfies subadditivity: MOE_sum <= sum(MOE_i) across all values', () => {
      fc.assert(
        fc.property(
          fc.array(fc.double({ min: 0, max: 10000, noNaN: true }), { minLength: 1, maxLength: 20 }),
          (moes) => {
            const sumMoe = calculateSumMoe(moes);
            const linearSum = moes.reduce((a, b) => a + b, 0);
            return sumMoe <= linearSum + 1e-9;
          }
        )
      );
    });
  });

  describe('calculateRatioMoe', () => {
    it('calculates ratio MOE accurately for known values', () => {
      // ratio = 100 / 200 = 0.5. numMoe = 10, denMoe = 20.
      // variance = 10^2 + 0.5^2 * 20^2 = 100 + 0.25 * 400 = 200.
      // sqrt(200) / 200 = 14.1421356 / 200 = 0.070710678
      const moe = calculateRatioMoe(100, 10, 200, 20);
      expect(moe).toBeCloseTo(0.07071, 4);
    });

    it('throws when denominator is zero', () => {
      expect(() => calculateRatioMoe(100, 10, 0, 20)).toThrow(/Denominator cannot be zero/);
    });
  });

  describe('calculateProportionMoe', () => {
    it('calculates proportion MOE with positive radicand', () => {
      const moe = calculateProportionMoe(50, 5, 200, 10);
      expect(moe).toBeGreaterThan(0);
      expect(Number.isFinite(moe)).toBe(true);
    });

    it('uses Census fallback when radicand is negative without crashing', () => {
      // Small numerator with large denominator MOE
      const moe = calculateProportionMoe(10, 1, 100, 50);
      expect(moe).toBeGreaterThan(0);
      expect(Number.isFinite(moe)).toBe(true);
    });
  });

  describe('calculateProductMoe', () => {
    it('calculates product MOE accurately', () => {
      const moe = calculateProductMoe(10, 1, 20, 2);
      // variance = 10^2 * 2^2 + 20^2 * 1^2 = 100 * 4 + 400 * 1 = 800
      // sqrt(800) = 28.28427
      expect(moe).toBeCloseTo(28.284, 3);
    });
  });

  describe('scaleMoeConfidence', () => {
    it('scales between 90% and 95% accurately', () => {
      const moe90 = 1.645;
      const moe95 = scaleMoeConfidence(moe90, 90, 95);
      expect(moe95).toBeCloseTo(1.96, 4);
    });

    it('returns same value when from and to confidence match', () => {
      expect(scaleMoeConfidence(10, 90, 90)).toBe(10);
      expect(scaleMoeConfidence(10, 95, 95)).toBe(10);
    });

    it('is reversible within precision', () => {
      fc.assert(
        fc.property(fc.double({ min: 0.01, max: 10000, noNaN: true }), (val) => {
          const scaled = scaleMoeConfidence(val, 90, 99);
          const restored = scaleMoeConfidence(scaled, 99, 90);
          return Math.abs(restored - val) / val < 1e-6;
        })
      );
    });
  });
});
