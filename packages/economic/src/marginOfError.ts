/**
 * Statistical Margin of Error (MOE) calculations implementing U.S. Census Bureau
 * standard formulas for American Community Survey (ACS) data combination.
 *
 * References:
 * - U.S. Census Bureau, "Understanding and Using American Community Survey Data: What All Data Users Need to Know"
 * - Appendix 3: Measures of Sampling Error & Combining Estimates
 */

export const ACS_Z_SCORES = {
  90: 1.645,
  95: 1.96,
  99: 2.576,
} as const;
export type SupportedConfidenceLevel = keyof typeof ACS_Z_SCORES;

/**
 * Calculates the Margin of Error for a sum of independent estimates.
 * Formula: MOE_sum = sqrt(sum(MOE_i^2))
 */
export function calculateSumMoe(moes: readonly number[]): number {
  if (moes.length === 0) {
    return 0;
  }
  let sumOfSquares = 0;
  for (const moe of moes) {
    if (!Number.isFinite(moe) || moe < 0) {
      throw new RangeError(
        `Margin of error must be a finite non-negative number, received: ${moe}`
      );
    }
    sumOfSquares += moe * moe;
  }
  return Math.sqrt(sumOfSquares);
}

/**
 * Calculates the Margin of Error for a derived ratio of two estimates (where numerator is NOT a subset of denominator).
 * Formula: MOE_ratio = sqrt(MOE_num^2 + ratio^2 * MOE_den^2) / den
 */
export function calculateRatioMoe(
  numerator: number,
  numMoe: number,
  denominator: number,
  denMoe: number
): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    throw new RangeError('Numerator and denominator must be finite numbers');
  }
  if (!Number.isFinite(numMoe) || numMoe < 0 || !Number.isFinite(denMoe) || denMoe < 0) {
    throw new RangeError('Margins of error must be finite non-negative numbers');
  }
  if (denominator === 0) {
    throw new RangeError('Denominator cannot be zero in ratio calculation');
  }

  const ratio = numerator / denominator;
  const variance = numMoe * numMoe + ratio * ratio * denMoe * denMoe;
  return Math.sqrt(variance) / Math.abs(denominator);
}

/**
 * Calculates the Margin of Error for a derived proportion (where numerator IS a subset of denominator, 0 <= P <= 1).
 * Standard Census formula:
 *   radicand = MOE_num^2 - P^2 * MOE_den^2
 *   If radicand > 0: MOE_prop = sqrt(radicand) / den
 *   If radicand <= 0: Fallback to ratio formula sqrt(MOE_num^2 + P^2 * MOE_den^2) / den
 */
export function calculateProportionMoe(
  numerator: number,
  numMoe: number,
  denominator: number,
  denMoe: number
): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    throw new RangeError('Numerator and denominator must be finite numbers');
  }
  if (!Number.isFinite(numMoe) || numMoe < 0 || !Number.isFinite(denMoe) || denMoe < 0) {
    throw new RangeError('Margins of error must be finite non-negative numbers');
  }
  if (denominator === 0) {
    throw new RangeError('Denominator cannot be zero in proportion calculation');
  }

  const proportion = numerator / denominator;
  const pSq = proportion * proportion;
  const radicand = numMoe * numMoe - pSq * denMoe * denMoe;

  if (radicand > 0) {
    return Math.sqrt(radicand) / Math.abs(denominator);
  }

  // Census Bureau recommended fallback when radicand is non-positive
  const fallbackRadicand = numMoe * numMoe + pSq * denMoe * denMoe;
  return Math.sqrt(fallbackRadicand) / Math.abs(denominator);
}

/**
 * Calculates the Margin of Error for a product of two estimates (Z = X * Y).
 * Formula: MOE_product = sqrt(X^2 * MOE_Y^2 + Y^2 * MOE_X^2)
 */
export function calculateProductMoe(x: number, xMoe: number, y: number, yMoe: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError('Values must be finite numbers');
  }
  if (!Number.isFinite(xMoe) || xMoe < 0 || !Number.isFinite(yMoe) || yMoe < 0) {
    throw new RangeError('Margins of error must be finite non-negative numbers');
  }

  const variance = x * x * yMoe * yMoe + y * y * xMoe * xMoe;
  return Math.sqrt(variance);
}

/**
 * Scales an MOE from one confidence level to another.
 * Formula: MOE_target = MOE_source * (Z_target / Z_source)
 */
export function scaleMoeConfidence(
  moe: number,
  fromConfidence: SupportedConfidenceLevel,
  toConfidence: SupportedConfidenceLevel
): number {
  if (!Number.isFinite(moe) || moe < 0) {
    throw new RangeError('Margin of error must be a finite non-negative number');
  }
  if (fromConfidence === toConfidence) {
    return moe;
  }
  const fromZ = ACS_Z_SCORES[fromConfidence];
  const toZ = ACS_Z_SCORES[toConfidence];
  return moe * (toZ / fromZ);
}
