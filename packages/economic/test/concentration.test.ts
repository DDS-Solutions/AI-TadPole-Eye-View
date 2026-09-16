import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateHhiFromShares, calculateHhiFromValues } from '../src/concentration.js';

describe('Market Concentration (HHI) Calculations', () => {
  it('returns 10000 for pure monopoly (100% share)', () => {
    const result = calculateHhiFromShares([100]);
    expect(result.hhi).toBe(10000);
    expect(result.tier).toBe('highly_concentrated');
    expect(result.firm_count).toBe(1);
    expect(result.top_share_pct).toBe(100);
    expect(result.cr4_pct).toBe(100);
  });

  it('calculates equal duopoly (50% + 50%) as 5000', () => {
    const result = calculateHhiFromShares([50, 50]);
    expect(result.hhi).toBe(5000);
    expect(result.tier).toBe('highly_concentrated');
    expect(result.cr4_pct).toBe(100);
  });

  it('calculates 10 equal firms (10% each) as 1000 (unconcentrated)', () => {
    const shares = Array(10).fill(10);
    const result = calculateHhiFromShares(shares);
    expect(result.hhi).toBe(1000);
    expect(result.tier).toBe('unconcentrated');
    expect(result.cr4_pct).toBe(40);
  });

  it('detects moderately concentrated market (1500 <= HHI <= 2500)', () => {
    // 30, 25, 20, 15, 10: 900 + 625 + 400 + 225 + 100 = 2250
    const result = calculateHhiFromShares([30, 25, 20, 15, 10]);
    expect(result.hhi).toBe(2250);
    expect(result.tier).toBe('moderately_concentrated');
    expect(result.cr4_pct).toBe(90);
  });

  it('normalizes raw firm values properly', () => {
    const rawEmployees = [100, 100, 100, 100];
    const result = calculateHhiFromValues(rawEmployees);
    // 4 equal firms = 25% each -> 4 * 625 = 2500
    expect(result.hhi).toBe(2500);
    expect(result.tier).toBe('moderately_concentrated');
    expect(result.firm_count).toBe(4);
    expect(result.top_share_pct).toBe(25);
  });

  it('returns 0 for empty arrays', () => {
    expect(calculateHhiFromShares([]).hhi).toBe(0);
    expect(calculateHhiFromValues([]).hhi).toBe(0);
  });

  it('throws when share sum exceeds 100%', () => {
    expect(() => calculateHhiFromShares([60, 50])).toThrow(/cannot exceed 100%/);
  });

  it('guarantees HHI is bounded between 0 and 10000 across arbitrary shares', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.double({ min: 0.1, max: 100, noNaN: true }), { minLength: 1, maxLength: 20 })
          .map((arr) => {
            const sum = arr.reduce((a, b) => a + b, 0);
            return arr.map((v) => (v / sum) * 100);
          }),
        (shares) => {
          const res = calculateHhiFromShares(shares);
          return res.hhi >= 0 && res.hhi <= 10000;
        }
      )
    );
  });
});
