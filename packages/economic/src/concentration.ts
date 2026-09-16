/**
 * Market and industry concentration metrics implementing the Herfindahl-Hirschman Index (HHI)
 * and Concentration Ratios (CR4 / CR8) per DOJ/FTC Horizontal Merger Guidelines.
 */

export const HHI_THRESHOLDS = {
  UNCONCENTRATED_CEILING: 1500,
  MODERATELY_CONCENTRATED_CEILING: 2500,
  MAX_POSSIBLE: 10000,
} as const;

export type MarketConcentrationTier =
  | 'unconcentrated'
  | 'moderately_concentrated'
  | 'highly_concentrated';

export interface HhiResult {
  hhi: number;
  tier: MarketConcentrationTier;
  firm_count: number;
  top_share_pct: number;
  cr4_pct?: number;
}

/**
 * Calculates the Herfindahl-Hirschman Index (HHI) from an array of percentage market shares (0 to 100).
 * Formula: HHI = sum(s_i^2)
 */
export function calculateHhiFromShares(shares: readonly number[]): HhiResult {
  if (shares.length === 0) {
    return {
      hhi: 0,
      tier: 'unconcentrated',
      firm_count: 0,
      top_share_pct: 0,
    };
  }

  let totalShare = 0;
  let sumOfSquares = 0;
  let maxShare = 0;

  for (const s of shares) {
    if (!Number.isFinite(s) || s < 0) {
      throw new RangeError(
        `Market share percentage must be a finite non-negative number, received: ${s}`
      );
    }
    totalShare += s;
    sumOfSquares += s * s;
    if (s > maxShare) {
      maxShare = s;
    }
  }

  if (totalShare > 100.001) {
    throw new RangeError(`Sum of market shares cannot exceed 100%, received total: ${totalShare}`);
  }

  const hhi = Math.min(Math.round(sumOfSquares * 100) / 100, HHI_THRESHOLDS.MAX_POSSIBLE);

  let tier: MarketConcentrationTier = 'unconcentrated';
  if (hhi > HHI_THRESHOLDS.MODERATELY_CONCENTRATED_CEILING) {
    tier = 'highly_concentrated';
  } else if (hhi >= HHI_THRESHOLDS.UNCONCENTRATED_CEILING) {
    tier = 'moderately_concentrated';
  }

  // Calculate CR4 if applicable
  const sorted = [...shares].sort((a, b) => b - a);
  const cr4 = sorted.slice(0, 4).reduce((acc, val) => acc + val, 0);

  return {
    hhi,
    tier,
    firm_count: shares.length,
    top_share_pct: Math.round(maxShare * 100) / 100,
    cr4_pct: Math.round(cr4 * 100) / 100,
  };
}

/**
 * Normalizes raw firm sizes (e.g. employee count or revenue) into percentage shares and computes HHI.
 */
export function calculateHhiFromValues(rawValues: readonly number[]): HhiResult {
  if (rawValues.length === 0) {
    return {
      hhi: 0,
      tier: 'unconcentrated',
      firm_count: 0,
      top_share_pct: 0,
    };
  }

  let total = 0;
  for (const v of rawValues) {
    if (!Number.isFinite(v) || v < 0) {
      throw new RangeError(`Firm value must be a finite non-negative number, received: ${v}`);
    }
    total += v;
  }

  if (total === 0) {
    return {
      hhi: 0,
      tier: 'unconcentrated',
      firm_count: rawValues.length,
      top_share_pct: 0,
    };
  }

  const shares = rawValues.map((v) => (v / total) * 100);
  return calculateHhiFromShares(shares);
}
