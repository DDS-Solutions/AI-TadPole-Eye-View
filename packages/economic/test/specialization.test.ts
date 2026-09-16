import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateLocationQuotient, calculateShiftShare } from '../src/specialization.js';

describe('Specialization & Growth Dynamics (LQ & Shift-Share)', () => {
  describe('calculateLocationQuotient', () => {
    it('detects high specialization when local industry share exceeds benchmark', () => {
      // Local: 200 in tech out of 1000 total = 20%
      // National: 1000 in tech out of 10000 total = 10%
      // LQ = 20% / 10% = 2.0
      const res = calculateLocationQuotient(200, 1000, 1000, 10000);
      expect(res.lq).toBe(2);
      expect(res.tier).toBe('high_specialization');
      expect(res.local_share_pct).toBe(20);
      expect(res.benchmark_share_pct).toBe(10);
    });

    it('detects underrepresentation when local industry share lags benchmark', () => {
      // Local: 50 out of 1000 = 5%
      // National: 1500 out of 10000 = 15%
      // LQ = 5 / 15 = 0.333
      const res = calculateLocationQuotient(50, 1000, 1500, 10000);
      expect(res.lq).toBeCloseTo(0.333, 3);
      expect(res.tier).toBe('underrepresented');
    });

    it('handles zero local employment cleanly', () => {
      const res = calculateLocationQuotient(0, 1000, 500, 10000);
      expect(res.lq).toBe(0);
      expect(res.tier).toBe('underrepresented');
    });

    it('throws when industry employment exceeds total', () => {
      expect(() => calculateLocationQuotient(1500, 1000, 500, 10000)).toThrow(
        /cannot exceed total local value/
      );
    });
  });

  describe('calculateShiftShare', () => {
    it('decomposes employment change and satisfies fundamental identity', () => {
      // Base:
      // Local industry: 100, Local current: 150 (Total change = +50)
      // Benchmark industry: 1000 -> 1200 (+20%)
      // Benchmark total: 10000 -> 11000 (+10%)
      const res = calculateShiftShare(100, 150, 1000, 1200, 10000, 11000);

      // National Growth: 100 * 10% = +10
      expect(res.national_growth_effect).toBe(10);
      // Industry Mix: 100 * (20% - 10%) = +10
      expect(res.industry_mix_effect).toBe(10);
      // Local change = +50. Expected = 10 + 10 = 20. Competitive share = 50 - 20 = +30.
      expect(res.competitive_share_effect).toBe(30);
      expect(res.total_local_change).toBe(50);
      expect(res.expected_local_change).toBe(20);
      expect(res.net_relative_performance).toBe(30);

      // Verification of identity
      const identitySum =
        res.national_growth_effect + res.industry_mix_effect + res.competitive_share_effect;
      expect(identitySum).toBeCloseTo(res.total_local_change, 2);
    });

    it('preserves shift-share additive identity across random economic scenarios', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 10, max: 10000, noNaN: true }),
          fc.double({ min: 10, max: 10000, noNaN: true }),
          fc.double({ min: 100, max: 100000, noNaN: true }),
          fc.double({ min: 100, max: 100000, noNaN: true }),
          fc.double({ min: 1000, max: 1000000, noNaN: true }),
          fc.double({ min: 1000, max: 1000000, noNaN: true }),
          (localBase, localCurrent, indBase, indCurrent, totBase, totCurrent) => {
            const res = calculateShiftShare(
              localBase,
              localCurrent,
              indBase,
              indCurrent,
              totBase,
              totCurrent
            );
            const sum =
              res.national_growth_effect + res.industry_mix_effect + res.competitive_share_effect;
            return Math.abs(sum - res.total_local_change) < 0.1;
          }
        )
      );
    });
  });
});
