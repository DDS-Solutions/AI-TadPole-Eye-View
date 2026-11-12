import {
  type DotBtsAccessibilityRecord,
  type EconomicEstimate,
  type EconomicEvidenceRecord,
  type EconomicGeography,
  type EpaAqsQueryResult,
  type FemaNfhlRiskCategory,
  type FemaNfhlSummary,
  type FemaNriRiskRating,
  SITE_RISK_SCHEMA_VERSION,
  SITE_RISK_SCREENING_DISCLAIMER,
  type SiteRiskAccessibilitySummary,
  type SiteRiskAssessmentResult,
  SiteRiskAssessmentResultSchema,
  type SiteRiskCurrentOperationalAlerts,
  type SiteRiskLongTermHazards,
  type SiteRiskScreeningTier,
  type SiteRiskSourceAttribution,
  type Usgs3DepElevationPointResult,
  type Usgs3DepSlopeResult,
} from '@gev/contracts';
import { createDefaultSynthesisProvenance } from './multiSourceEvidence.js';

export { SITE_RISK_SCHEMA_VERSION, SITE_RISK_SCREENING_DISCLAIMER };

// ============================================================================
// Pure Site-Risk Screening Engine (PLAN.md §10 Task 11.4 & Phase 11 Exit)
// ============================================================================

export type OperationalAlertSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

export interface SiteRiskOperationalAlertInput {
  id: string;
  event: string;
  severity: OperationalAlertSeverity;
  headline?: string;
}

export interface SiteRiskAssessmentInput {
  geography: EconomicGeography;
  isoTimestamp: string;
  femaNriRecords?: readonly EconomicEvidenceRecord[];
  femaNfhlSummary?: FemaNfhlSummary;
  usgsElevation?: Usgs3DepElevationPointResult;
  usgsSlope?: Usgs3DepSlopeResult;
  epaAqsResult?: EpaAqsQueryResult;
  dotBtsRecord?: DotBtsAccessibilityRecord;
  currentAlerts?: readonly SiteRiskOperationalAlertInput[];
}

const unavail = (reason: string): EconomicEstimate => ({ status: 'unavailable', reason });

const ALERT_SEVERITY_RANK: Record<OperationalAlertSeverity, number> = {
  Extreme: 5,
  Severe: 4,
  Moderate: 3,
  Minor: 2,
  Unknown: 1,
};

function parseNriRatingFromRecord(rec: EconomicEvidenceRecord | undefined): FemaNriRiskRating {
  if (!rec) return 'Not Applicable';
  if (rec.estimate.status === 'available' && rec.estimate.notes) {
    const valid: readonly FemaNriRiskRating[] = [
      'Very Low',
      'Relatively Low',
      'Relatively Moderate',
      'Relatively High',
      'Very High',
      'Insufficient Data',
      'Not Applicable',
    ];
    const match = valid.find(
      (r) => rec.estimate.status === 'available' && rec.estimate.notes?.includes(r)
    );
    if (match) return match;
  }
  if (rec.estimate.status === 'available') {
    const val = rec.estimate.value;
    if (val >= 80) return 'Very High';
    if (val >= 60) return 'Relatively High';
    if (val >= 40) return 'Relatively Moderate';
    if (val >= 20) return 'Relatively Low';
    return 'Very Low';
  }
  return 'Insufficient Data';
}

function summarizeCurrentOperationalAlerts(
  alerts: readonly SiteRiskOperationalAlertInput[] | undefined
): SiteRiskCurrentOperationalAlerts {
  if (!alerts || alerts.length === 0) {
    return {
      horizon: 'current_operational_alert',
      is_live_condition: true,
      active_alert_count: 0,
      highest_severity: 'None',
      alert_headlines: [],
      source_note:
        'No active short-term operational alerts provided; distinct from long-term structural hazards.',
    };
  }

  let highest: OperationalAlertSeverity = 'Unknown';
  let bestRank = 0;
  for (const alert of alerts) {
    const rank = ALERT_SEVERITY_RANK[alert.severity] ?? 1;
    if (rank > bestRank) {
      bestRank = rank;
      highest = alert.severity;
    }
  }

  return {
    horizon: 'current_operational_alert',
    is_live_condition: true,
    active_alert_count: alerts.length,
    highest_severity: highest,
    alert_headlines: alerts.slice(0, 25).map((a) => `${a.severity}: ${a.headline ?? a.event}`),
    source_note:
      'Active operational alerts reflect current/transient conditions and are kept strictly separate from long-term hazard scores.',
  };
}

function summarizeAccessibilityContext(
  dotBts: DotBtsAccessibilityRecord | undefined,
  dataGaps: string[],
  sourceSignals: SiteRiskSourceAttribution[],
  geography: EconomicGeography
): SiteRiskAccessibilitySummary {
  if (!dotBts?.is_covered) {
    dataGaps.push(
      'DOT/BTS transportation accessibility metrics are unavailable for this geography.'
    );
    sourceSignals.push({
      source_id: 'dot-bts-access',
      product_name: 'DOT/BTS National Transportation Atlas & Transit Access',
      vintage:
        dotBts?.provenance.vintage.status === 'available'
          ? dotBts.provenance.vintage.value
          : 'Unavailable',
      geography: dotBts?.geography ?? geography,
      mode: dotBts?.provenance.mode ?? 'unavailable',
      status: 'unavailable',
    });
    const gapEst = unavail('DOT/BTS accessibility metrics unavailable');
    return {
      accessibility_tier: 'unavailable',
      freight_exposure: 'unavailable',
      nearest_interstate_km: gapEst,
      nearest_transit_stop_km: gapEst,
      commute_mean_minutes: gapEst,
    };
  }

  sourceSignals.push({
    source_id: 'dot-bts-access',
    product_name: dotBts.provenance.source.name,
    vintage:
      dotBts.provenance.vintage.status === 'available'
        ? dotBts.provenance.vintage.value
        : 'DOT/BTS 2024',
    geography: dotBts.geography,
    mode: dotBts.provenance.mode,
    status: 'available',
  });

  return {
    accessibility_tier: dotBts.accessibility_tier,
    freight_exposure: dotBts.freight_exposure,
    nearest_interstate_km: dotBts.nearest_interstate_km,
    nearest_transit_stop_km: dotBts.nearest_transit_stop_km,
    commute_mean_minutes: dotBts.commute_mean_minutes,
  };
}

function collectHistoricalAirExceedances(
  epaAqs: EpaAqsQueryResult,
  dataGaps: string[]
): { flags: string[]; hasAvailableSignal: boolean } {
  const flags: string[] = [];
  let hasAvailableSignal = false;

  for (const cov of epaAqs.pollutant_coverage) {
    if (!cov.is_monitored || cov.latest_arithmetic_mean.status !== 'available') {
      dataGaps.push(
        `EPA AQS historical monitoring unavailable/unmonitored for ${cov.pollutant_symbol} (${cov.parameter_code}).`
      );
      continue;
    }

    hasAvailableSignal = true;
    const val = cov.latest_arithmetic_mean.value;
    if (cov.pollutant_symbol === 'O3' && val >= 0.07) {
      flags.push(`Historical AQS O3 screening level (${val} ppm >= 0.070 ppm benchmark)`);
    } else if (cov.pollutant_symbol === 'PM2.5' && val >= 9.0) {
      flags.push(
        `Historical AQS PM2.5 annual screening level (${val} ug/m3 >= 9.0 ug/m3 benchmark)`
      );
    } else if (cov.pollutant_symbol === 'PM10' && val >= 50) {
      flags.push(`Historical AQS PM10 elevated screening mean (${val} ug/m3)`);
    } else if (cov.pollutant_symbol === 'NO2' && val >= 53) {
      flags.push(`Historical AQS NO2 annual screening level (${val} ppb >= 53 ppb benchmark)`);
    } else if (cov.pollutant_symbol === 'SO2' && val >= 75) {
      flags.push(`Historical AQS SO2 1-hr benchmark level (${val} ppb >= 75 ppb)`);
    }
  }

  return { flags, hasAvailableSignal };
}

function deriveScreeningTier(score: number): SiteRiskScreeningTier {
  if (score >= 65) return 'elevated_screening_concern';
  if (score >= 35) return 'moderate_screening_concern';
  return 'low_screening_concern';
}

/**
 * Pure multi-source site-risk and accessibility screening function.
 * Combines FEMA NRI/NFHL, USGS 3DEP, EPA AQS (historical), and DOT/BTS context
 * while keeping current operational alerts strictly separate and never coercing
 * missing/unmonitored/off-coverage signals to zero risk.
 */
export function assessSiteRisk(input: SiteRiskAssessmentInput): SiteRiskAssessmentResult {
  const dataGaps: string[] = [];
  const sourceSignals: SiteRiskSourceAttribution[] = [];
  const subScores: Array<{ weight: number; score: number }> = [];

  // 1. FEMA NRI (Long-term multi-hazard composite)
  const nriCompositeRec = input.femaNriRecords?.find(
    (r) => r.variable_name === 'RISK_SCORE' || r.metric_id === 'nri-composite-risk-score'
  );
  const nriRatingRec = input.femaNriRecords?.find(
    (r) => r.variable_name === 'RISK_RATNG' || r.metric_id === 'nri-risk-rating'
  );
  const femaNriScore: EconomicEstimate =
    nriCompositeRec?.estimate ?? unavail('FEMA NRI composite risk score not supplied');
  const femaNriRating: FemaNriRiskRating = parseNriRatingFromRecord(
    nriRatingRec ?? nriCompositeRec
  );

  if (femaNriScore.status === 'available' && nriCompositeRec) {
    subScores.push({ weight: 0.45, score: Math.min(100, Math.max(0, femaNriScore.value)) });
    sourceSignals.push({
      source_id: 'fema-nri',
      product_name: nriCompositeRec.provenance.source.name,
      vintage:
        nriCompositeRec.provenance.vintage.status === 'available'
          ? nriCompositeRec.provenance.vintage.value
          : 'November 2023',
      geography: nriCompositeRec.geography,
      mode: nriCompositeRec.provenance.mode,
      status: 'available',
    });
  } else {
    dataGaps.push('FEMA National Risk Index (NRI) composite score is unavailable.');
    sourceSignals.push({
      source_id: 'fema-nri',
      product_name: 'FEMA National Risk Index (NRI)',
      vintage: 'Unavailable',
      geography: input.geography,
      mode: 'unavailable',
      status: 'unavailable',
    });
  }

  // 2. FEMA NFHL (Long-term flood zone screening)
  let femaNfhlRiskCategory: FemaNfhlRiskCategory = 'unknown';
  let inSfha: boolean | null = null;
  if (input.femaNfhlSummary) {
    femaNfhlRiskCategory = input.femaNfhlSummary.risk_category;
    inSfha = input.femaNfhlSummary.in_sfha;
    sourceSignals.push({
      source_id: 'fema-nfhl',
      product_name: input.femaNfhlSummary.provenance.source.name,
      vintage:
        input.femaNfhlSummary.provenance.vintage.status === 'available'
          ? input.femaNfhlSummary.provenance.vintage.value
          : 'NFHL Active',
      geography: input.femaNfhlSummary.geography,
      mode: input.femaNfhlSummary.provenance.mode,
      status: femaNfhlRiskCategory === 'undetermined_risk_zone_d' ? 'partial' : 'available',
    });
    if (femaNfhlRiskCategory === 'high_risk_sfha') {
      subScores.push({ weight: 0.3, score: 85 });
    } else if (femaNfhlRiskCategory === 'moderate_risk_500yr') {
      subScores.push({ weight: 0.3, score: 45 });
    } else if (femaNfhlRiskCategory === 'minimal_risk_outside_sfha') {
      subScores.push({ weight: 0.3, score: 15 });
    } else {
      dataGaps.push(`FEMA NFHL flood hazard is undetermined (${femaNfhlRiskCategory}).`);
    }
  } else {
    dataGaps.push('FEMA National Flood Hazard Layer (NFHL) zone classification is unavailable.');
    sourceSignals.push({
      source_id: 'fema-nfhl',
      product_name: 'FEMA National Flood Hazard Layer (NFHL)',
      vintage: 'Unavailable',
      geography: input.geography,
      mode: 'unavailable',
      status: 'unavailable',
    });
  }

  // 3. USGS 3DEP Elevation & Terrain Slope
  const elevationMeters: EconomicEstimate =
    input.usgsElevation && !input.usgsElevation.is_off_coverage
      ? input.usgsElevation.elevation_meters
      : unavail('USGS 3DEP elevation unavailable or off-coverage');
  const slopePercent: EconomicEstimate =
    input.usgsSlope?.slope_percent ?? unavail('USGS 3DEP terrain slope not supplied');

  if (elevationMeters.status === 'available' && input.usgsElevation) {
    sourceSignals.push({
      source_id: 'usgs-3dep',
      product_name: input.usgsElevation.provenance.source.name,
      vintage:
        input.usgsElevation.provenance.vintage.status === 'available'
          ? input.usgsElevation.provenance.vintage.value
          : '3DEP 1/3 arc-second',
      geography: {
        level: 'point',
        latitude: input.usgsElevation.point.y,
        longitude: input.usgsElevation.point.x,
      },
      mode: input.usgsElevation.provenance.mode,
      status: 'available',
    });
    const elevScore = elevationMeters.value <= 3.0 ? 70 : elevationMeters.value <= 10.0 ? 35 : 15;
    subScores.push({ weight: 0.1, score: elevScore });
  } else {
    dataGaps.push('USGS 3DEP NAVD88 elevation is unavailable or off-coverage.');
    sourceSignals.push({
      source_id: 'usgs-3dep',
      product_name: 'USGS 3DEP Elevation Point Query Service (EPQS)',
      vintage: 'Unavailable',
      geography: input.geography,
      mode: 'unavailable',
      status: 'unavailable',
    });
  }

  if (slopePercent.status === 'available') {
    const slopeScore = slopePercent.value >= 15 ? 75 : slopePercent.value >= 5 ? 40 : 15;
    subScores.push({ weight: 0.05, score: slopeScore });
  }

  // 4. EPA AQS Historical Regulatory Air Monitoring (never real-time AQI)
  let airExceedanceFlags: string[] = [];
  if (input.epaAqsResult) {
    const air = collectHistoricalAirExceedances(input.epaAqsResult, dataGaps);
    airExceedanceFlags = air.flags;
    sourceSignals.push({
      source_id: 'epa-aqs',
      product_name: `${input.epaAqsResult.provenance.source.name} (Historical Regulatory Monitoring)`,
      vintage:
        input.epaAqsResult.provenance.vintage.status === 'available'
          ? input.epaAqsResult.provenance.vintage.value
          : 'EPA AQS 2024',
      geography: input.epaAqsResult.geography,
      mode: input.epaAqsResult.provenance.mode,
      status: air.hasAvailableSignal ? 'available' : 'partial',
      notes: 'Historical regulatory monitoring only; not real-time AQI.',
    });
    if (air.hasAvailableSignal) {
      subScores.push({ weight: 0.1, score: air.flags.length > 0 ? 65 : 20 });
    }
  } else {
    dataGaps.push('EPA AQS historical regulatory air monitoring summary is unavailable.');
    sourceSignals.push({
      source_id: 'epa-aqs',
      product_name: 'U.S. EPA Air Quality System (AQS) Historical Monitoring',
      vintage: 'Unavailable',
      geography: input.geography,
      mode: 'unavailable',
      status: 'unavailable',
    });
  }

  // 5. DOT/BTS Accessibility Context
  const accessibilityContext = summarizeAccessibilityContext(
    input.dotBtsRecord,
    dataGaps,
    sourceSignals,
    input.geography
  );

  // 6. Current Operational Alerts (strictly separated from long-term hazards)
  const currentOperationalAlerts = summarizeCurrentOperationalAlerts(input.currentAlerts);

  const longTermHazards: SiteRiskLongTermHazards = {
    horizon: 'long_term_structural_hazard',
    fema_nri_composite_score: femaNriScore,
    fema_nri_rating: femaNriRating,
    fema_nfhl_risk_category: femaNfhlRiskCategory,
    in_sfha: inSfha,
    elevation_meters: elevationMeters,
    terrain_slope_percent: slopePercent,
    historical_air_exceedance_flags: airExceedanceFlags,
    available_signal_count: subScores.length,
  };

  let overallScore: EconomicEstimate;
  let screeningTier: SiteRiskScreeningTier;
  if (subScores.length === 0) {
    overallScore = unavail('Insufficient long-term hazard signals to compute screening score');
    screeningTier = 'insufficient_data';
  } else {
    const totalWeight = subScores.reduce((acc, s) => acc + s.weight, 0);
    const weighted = subScores.reduce((acc, s) => acc + s.score * s.weight, 0) / totalWeight;
    const rounded = Math.round(weighted * 100) / 100;
    overallScore = {
      status: 'available',
      value: rounded,
      margin_of_error: null,
      confidence_level: null,
      sample_size: subScores.length,
      unit: 'screening_index_0_100',
      notes: 'Weighted multi-source screening indicator; not a definitive risk rating.',
    };
    screeningTier = deriveScreeningTier(rounded);
  }

  return SiteRiskAssessmentResultSchema.parse({
    schema_version: SITE_RISK_SCHEMA_VERSION,
    geography: input.geography,
    assessed_at: input.isoTimestamp,
    overall_screening_score: overallScore,
    screening_tier: screeningTier,
    long_term_hazards: longTermHazards,
    current_operational_alerts: currentOperationalAlerts,
    accessibility_context: accessibilityContext,
    source_signals: sourceSignals,
    data_gaps: dataGaps,
    is_definitive_advice: false,
    provenance: createDefaultSynthesisProvenance(input.isoTimestamp),
    advisory_disclaimer: SITE_RISK_SCREENING_DISCLAIMER,
  });
}
