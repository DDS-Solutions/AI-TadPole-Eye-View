/**
 * Regional economic specialization and growth dynamics:
 * - Location Quotient (LQ)
 * - Shift-Share Analysis (National Growth, Industry Mix, Competitive Share)
 */

export type LqSpecializationTier = 'high_specialization' | 'average' | 'underrepresented';

export interface LocationQuotientResult {
  lq: number;
  local_share_pct: number;
  benchmark_share_pct: number;
  tier: LqSpecializationTier;
}

/**
 * Calculates the Location Quotient (LQ) measuring regional industry specialization.
 * Formula: LQ = (local_industry / local_total) / (benchmark_industry / benchmark_total)
 */
export function calculateLocationQuotient(
  localIndustry: number,
  localTotal: number,
  benchmarkIndustry: number,
  benchmarkTotal: number
): LocationQuotientResult {
  if (
    !Number.isFinite(localIndustry) ||
    !Number.isFinite(localTotal) ||
    !Number.isFinite(benchmarkIndustry) ||
    !Number.isFinite(benchmarkTotal)
  ) {
    throw new RangeError('All employment/output inputs must be finite numbers');
  }
  if (localIndustry < 0 || localTotal < 0 || benchmarkIndustry < 0 || benchmarkTotal < 0) {
    throw new RangeError('Employment/output inputs cannot be negative');
  }
  if (localIndustry > localTotal) {
    throw new RangeError('Local industry value cannot exceed total local value');
  }
  if (benchmarkIndustry > benchmarkTotal) {
    throw new RangeError('Benchmark industry value cannot exceed total benchmark value');
  }
  if (localTotal === 0 || benchmarkTotal === 0 || benchmarkIndustry === 0) {
    return {
      lq: 0,
      local_share_pct: 0,
      benchmark_share_pct: 0,
      tier: 'underrepresented',
    };
  }

  const localShare = localIndustry / localTotal;
  const benchmarkShare = benchmarkIndustry / benchmarkTotal;
  const lq = Math.round((localShare / benchmarkShare) * 1000) / 1000;

  let tier: LqSpecializationTier = 'average';
  if (lq > 1.2) {
    tier = 'high_specialization';
  } else if (lq < 0.8) {
    tier = 'underrepresented';
  }

  return {
    lq,
    local_share_pct: Math.round(localShare * 10000) / 100,
    benchmark_share_pct: Math.round(benchmarkShare * 10000) / 100,
    tier,
  };
}

export interface ShiftShareResult {
  total_local_change: number;
  national_growth_effect: number;
  industry_mix_effect: number;
  competitive_share_effect: number;
  expected_local_change: number;
  net_relative_performance: number;
}

/**
 * Calculates Classical Shift-Share Analysis decomposing regional employment change
 * into National Growth Effect, Industry Mix Effect, and Local Competitive Share.
 *
 * Identity:
 *   total_local_change = national_growth_effect + industry_mix_effect + competitive_share_effect
 */
export function calculateShiftShare(
  localBase: number,
  localCurrent: number,
  benchmarkIndustryBase: number,
  benchmarkIndustryCurrent: number,
  benchmarkTotalBase: number,
  benchmarkTotalCurrent: number
): ShiftShareResult {
  if (
    !Number.isFinite(localBase) ||
    !Number.isFinite(localCurrent) ||
    !Number.isFinite(benchmarkIndustryBase) ||
    !Number.isFinite(benchmarkIndustryCurrent) ||
    !Number.isFinite(benchmarkTotalBase) ||
    !Number.isFinite(benchmarkTotalCurrent)
  ) {
    throw new RangeError('All employment figures must be finite numbers');
  }
  if (localBase <= 0 || benchmarkIndustryBase <= 0 || benchmarkTotalBase <= 0) {
    throw new RangeError('Base period employment values must be positive non-zero numbers');
  }

  const nationalGrowthRate = (benchmarkTotalCurrent - benchmarkTotalBase) / benchmarkTotalBase;
  const industryGrowthRate =
    (benchmarkIndustryCurrent - benchmarkIndustryBase) / benchmarkIndustryBase;
  const localGrowthRate = (localCurrent - localBase) / localBase;

  const totalLocalChange = localCurrent - localBase;
  const nationalGrowthEffect = localBase * nationalGrowthRate;
  const industryMixEffect = localBase * (industryGrowthRate - nationalGrowthRate);
  const competitiveShareEffect = localBase * (localGrowthRate - industryGrowthRate);

  const expectedLocalChange = nationalGrowthEffect + industryMixEffect;
  const netRelativePerformance = competitiveShareEffect;

  return {
    total_local_change: Math.round(totalLocalChange * 100) / 100,
    national_growth_effect: Math.round(nationalGrowthEffect * 100) / 100,
    industry_mix_effect: Math.round(industryMixEffect * 100) / 100,
    competitive_share_effect: Math.round(competitiveShareEffect * 100) / 100,
    expected_local_change: Math.round(expectedLocalChange * 100) / 100,
    net_relative_performance: Math.round(netRelativePerformance * 100) / 100,
  };
}
