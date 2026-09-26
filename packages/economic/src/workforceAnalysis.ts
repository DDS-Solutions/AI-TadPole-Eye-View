import {
  type DataProvenance,
  ECONOMIC_LEGAL_DISCLAIMER,
  ECONOMIC_SCHEMA_VERSION,
  type EconomicEstimate,
  type EconomicEvidenceBundle,
  type EconomicEvidenceRecord,
  WORKFORCE_LABOR_MARKET_SIGNAL_DISCLAIMER,
  type WorkforceAnalysisInput,
  type WorkforceAnalysisResult,
  checkForWorkerPii,
  type WorkforceConcentrationMetric,
  type WorkforceOccupationalSpecialization,
  type WorkforceUnemploymentSummary,
  type WorkforceWageDifferentialSummary,
  type WorkforceWagePercentiles,
  getNumericEstimateValue,
} from '@gev/contracts';
import { calculateHhiFromShares } from './concentration.js';
import { createDisagreementState, evaluateSourceLinkedDisagreement } from './disagreementState.js';
import {
  createDefaultSynthesisProvenance,
  findEvidenceRecord,
  synthesizeMultiSourceEvidenceBundle,
} from './multiSourceEvidence.js';
import { calculateLocationQuotient } from './specialization.js';

// ============================================================================
// Pure Workforce Analysis Engine (PLAN.md §8.2, §10.2, ADR 0061)
// ============================================================================

export const KNOWN_SOC_TITLES: Record<string, string> = {
  '00-0000': 'All Occupations',
  '11-0000': 'Management Occupations',
  '13-0000': 'Business & Financial Operations',
  '15-0000': 'Computer & Mathematical Occupations',
  '15-1252': 'Software Developers',
  '15-1211': 'Computer Systems Analysts',
  '17-0000': 'Architecture & Engineering Occupations',
  '19-0000': 'Life, Physical, & Social Science',
  '21-0000': 'Community & Social Service',
  '23-0000': 'Legal Occupations',
  '25-0000': 'Educational Instruction & Library',
  '27-0000': 'Arts, Design, Entertainment, Sports, & Media',
  '29-0000': 'Healthcare Practitioners & Technical',
  '29-1141': 'Registered Nurses',
  '31-0000': 'Healthcare Support Occupations',
  '33-0000': 'Protective Service Occupations',
  '35-0000': 'Food Preparation & Serving',
  '35-2014': 'Cooks, Restaurant',
  '37-0000': 'Building & Grounds Cleaning',
  '39-0000': 'Personal Care & Service',
  '41-0000': 'Sales & Related Occupations',
  '43-0000': 'Office & Administrative Support',
  '45-0000': 'Farming, Fishing, & Forestry',
  '47-0000': 'Construction & Extraction',
  '49-0000': 'Installation, Maintenance, & Repair',
  '51-0000': 'Production Occupations',
  '53-0000': 'Transportation & Material Moving',
};

const unavail = (reason: string): EconomicEstimate => ({ status: 'unavailable', reason });

function findOewsRecord(
  records: readonly EconomicEvidenceRecord[],
  socCode: string,
  varNameOrMetric: string
): EconomicEvidenceRecord | undefined {
  const normSoc = socCode.replace('-', '');
  return records.find((r) => {
    const otherSocMatch = r.evidence_id.match(/\b\d{6}\b/);
    if (otherSocMatch && otherSocMatch[0] !== normSoc && socCode !== '00-0000') {
      return false;
    }
    return (
      r.variable_name === varNameOrMetric ||
      r.metric_id === varNameOrMetric ||
      r.metric_id.includes(varNameOrMetric.toLowerCase().replace('_', '-'))
    );
  });
}

function calculateEstimateRatio(
  numEst: EconomicEstimate,
  denEst: EconomicEstimate,
  unit: string = 'ratio'
): EconomicEstimate {
  const numVal = getNumericEstimateValue(numEst);
  const denVal = getNumericEstimateValue(denEst);

  if (numVal !== undefined && denVal !== undefined && denVal > 0) {
    return {
      status: 'available',
      value: Math.round((numVal / denVal) * 100) / 100,
      unit,
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
    };
  }

  if (numEst.status === 'suppressed') {
    return {
      status: 'suppressed',
      reason: numEst.reason,
      detail: `Ratio suppressed: numerator suppressed (${numEst.detail})`,
      ...(numEst.bounds ? { bounds: numEst.bounds } : {}),
      unit,
    };
  }
  if (denEst.status === 'suppressed') {
    return {
      status: 'suppressed',
      reason: denEst.reason,
      detail: `Ratio suppressed: denominator suppressed (${denEst.detail})`,
      ...(denEst.bounds ? { bounds: denEst.bounds } : {}),
      unit,
    };
  }

  return unavail('Component estimate unavailable to calculate ratio');
}

function extractWagePercentiles(
  records: readonly EconomicEvidenceRecord[],
  socCode: string,
  prefix: 'H' | 'A'
): WorkforceWagePercentiles {
  const isH = prefix === 'H';
  const otherPrefix = isH ? 'A' : 'H';
  const lookup = (key: string): EconomicEstimate => {
    const direct = findOewsRecord(records, socCode, `${prefix}_${key}`)?.estimate;
    if (direct) return direct;
    const alt = findOewsRecord(records, socCode, `${otherPrefix}_${key}`)?.estimate;
    if (alt?.status === 'available' && typeof alt.value === 'number') {
      return {
        ...alt,
        value: isH ? Number((alt.value / 2080).toFixed(2)) : Math.round(alt.value * 2080),
        unit: isH ? 'USD_per_hour' : 'USD',
      };
    }
    if (alt && alt.status !== 'available') return alt;
    return unavail(`OEWS ${prefix}_${key} estimate not provided in evidence records`);
  };

  return {
    pct10: lookup('PCT10'),
    pct25: lookup('PCT25'),
    median: lookup('MEDIAN'),
    pct75: lookup('PCT75'),
    pct90: lookup('PCT90'),
    mean: lookup('MEAN'),
  };
}

function makeVarLink(rec: EconomicEvidenceRecord, fallbackVintage: string) {
  return {
    source_id: rec.source_id,
    variable_id: rec.variable_name,
    metric_id: rec.metric_id,
    vintage:
      rec.provenance.vintage.status === 'available'
        ? rec.provenance.vintage.value
        : fallbackVintage,
    attribution: rec.provenance.attribution,
  };
}

export function analyzeWorkforceContext(
  input: WorkforceAnalysisInput,
  clockTimestamp: string
): WorkforceAnalysisResult {
  checkForWorkerPii(input as unknown as Record<string, unknown>);
  const socCode = input.soc_code ?? '00-0000';
  const occupationTitle =
    input.occupation_title ?? KNOWN_SOC_TITLES[socCode] ?? `Occupation (SOC ${socCode})`;
  const analysisId = input.analysis_id ?? `wf-${Date.parse(clockTimestamp)}`;
  const tenantId = input.tenant_id ?? 'tenant-local';

  // 1. Wage Differentials
  const oewsRecords = input.oews_evidence ?? [];
  const hourlyPercentiles = extractWagePercentiles(oewsRecords, socCode, 'H');
  const annualPercentiles = extractWagePercentiles(oewsRecords, socCode, 'A');

  const ratio9010 = calculateEstimateRatio(hourlyPercentiles.pct90, hourlyPercentiles.pct10);
  const ratio7525 = calculateEstimateRatio(hourlyPercentiles.pct75, hourlyPercentiles.pct25);

  const benchmarkMedianRec = oewsRecords.find(
    (r) =>
      r.geography.level === 'nation' &&
      (r.variable_name === 'H_MEDIAN' || r.metric_id === 'hourly-median-wage')
  );
  const benchmarkMedianHourly: EconomicEstimate =
    benchmarkMedianRec?.estimate ??
    unavail('National benchmark median hourly wage not provided in OEWS evidence');
  const localToBenchmarkRatio = calculateEstimateRatio(
    hourlyPercentiles.median,
    benchmarkMedianHourly
  );

  let dispersionClassification: WorkforceWageDifferentialSummary['dispersion_classification'] =
    'moderate';
  const r9010Val = getNumericEstimateValue(ratio9010);
  if (r9010Val === undefined) {
    dispersionClassification = ratio9010.status === 'suppressed' ? 'suppressed' : 'moderate';
  } else if (r9010Val < 2.5) {
    dispersionClassification = 'compressed';
  } else if (r9010Val <= 4.0) {
    dispersionClassification = 'moderate';
  } else if (r9010Val <= 6.0) {
    dispersionClassification = 'dispersed';
  } else {
    dispersionClassification = 'highly_dispersed';
  }

  const wageDifferentials: WorkforceWageDifferentialSummary = {
    soc_code: socCode,
    occupation_title: occupationTitle,
    hourly_percentiles: hourlyPercentiles,
    annual_percentiles: annualPercentiles,
    ratio_90_10: ratio9010,
    ratio_75_25: ratio7525,
    benchmark_median_hourly_usd: benchmarkMedianHourly,
    local_to_benchmark_ratio: localToBenchmarkRatio,
    dispersion_classification: dispersionClassification,
  };

  // 2. Occupational Specialization (Location Quotient)
  const localSocEmpRec =
    findOewsRecord(oewsRecords, socCode, 'TOT_EMP') ??
    findEvidenceRecord(oewsRecords, 'total-employment');
  const localTotalEmpRec =
    findOewsRecord(oewsRecords, '00-0000', 'TOT_EMP') ??
    findEvidenceRecord(oewsRecords, 'total-local-employment');

  const normSoc = socCode.replace('-', '');
  const benchmarkSocEmpRec = oewsRecords.find(
    (r) =>
      r.geography.level === 'nation' &&
      r.variable_name === 'TOT_EMP' &&
      (r.evidence_id.includes(normSoc) || r.label.includes(socCode))
  );
  const benchmarkTotalEmpRec = oewsRecords.find(
    (r) =>
      r.geography.level === 'nation' &&
      r.variable_name === 'TOT_EMP' &&
      (r.evidence_id.includes('000000') ||
        r.label.includes('All Occupations') ||
        r.label.includes('00-0000'))
  );

  let lqValue: number | null = null;
  let lqTier: WorkforceOccupationalSpecialization['tier'] = 'average';

  const localSocVal = localSocEmpRec ? getNumericEstimateValue(localSocEmpRec.estimate) : undefined;
  const localTotVal = localTotalEmpRec
    ? getNumericEstimateValue(localTotalEmpRec.estimate)
    : undefined;
  const bmarkSocVal = benchmarkSocEmpRec
    ? getNumericEstimateValue(benchmarkSocEmpRec.estimate)
    : undefined;
  const bmarkTotVal = benchmarkTotalEmpRec
    ? getNumericEstimateValue(benchmarkTotalEmpRec.estimate)
    : undefined;

  if (
    localSocVal !== undefined &&
    localTotVal !== undefined &&
    bmarkSocVal !== undefined &&
    bmarkTotVal !== undefined &&
    localTotVal > 0 &&
    bmarkTotVal > 0 &&
    bmarkSocVal > 0
  ) {
    try {
      const lqRes = calculateLocationQuotient(localSocVal, localTotVal, bmarkSocVal, bmarkTotVal);
      lqValue = lqRes.lq;
      lqTier = lqRes.tier;
    } catch {
      lqValue = null;
      lqTier = 'average';
    }
  } else if (
    localSocEmpRec?.estimate.status === 'suppressed' ||
    localTotalEmpRec?.estimate.status === 'suppressed'
  ) {
    lqTier = 'suppressed';
    lqValue = null;
  }

  const occupationalSpecialization: WorkforceOccupationalSpecialization = {
    soc_code: socCode,
    occupation_title: occupationTitle,
    local_employment:
      localSocEmpRec?.estimate ??
      unavail(`Total employment for SOC ${socCode} not provided in OEWS evidence`),
    benchmark_employment:
      benchmarkSocEmpRec?.estimate ??
      unavail(`Benchmark employment for SOC ${socCode} not provided in OEWS evidence`),
    location_quotient: lqValue,
    tier: lqTier,
  };

  // 3. Labor-Market Concentration
  const empRecords = oewsRecords.filter(
    (r) => r.variable_name === 'TOT_EMP' && r.geography.level === input.target_geography.level
  );
  const empValues: number[] = [];
  for (const r of empRecords) {
    const val = getNumericEstimateValue(r.estimate);
    if (val !== undefined && val > 0) empValues.push(val);
  }

  let concentration: WorkforceConcentrationMetric;
  if (empValues.length > 1) {
    const totalLocal = empValues.reduce((a, b) => a + b, 0);
    const shares = empValues.map((v) => (v / totalLocal) * 100);
    const hhiRes = calculateHhiFromShares(shares);
    concentration = {
      hhi: hhiRes.hhi,
      tier: hhiRes.tier,
      occupation_count: hhiRes.firm_count,
      top_share_pct: hhiRes.top_share_pct,
      cr4_pct: hhiRes.cr4_pct,
    };
  } else {
    concentration = {
      hhi: 1200,
      tier: 'unconcentrated',
      occupation_count: empValues.length,
      top_share_pct: empValues.length > 0 ? 100 : 0,
      cr4_pct: empValues.length > 0 ? 100 : 0,
    };
  }

  // 4. Unemployment & Labor Force Dynamics
  const lauRecords = input.lau_evidence ?? [];
  const lauRateRec =
    lauRecords.find((r) => r.variable_name === 'LAU_RATE' || r.metric_id === 'unemployment-rate') ??
    findEvidenceRecord(lauRecords, 'unemployment-rate');
  const lauLaborForceRec =
    lauRecords.find(
      (r) => r.variable_name === 'LAU_LABOR_FORCE' || r.metric_id === 'labor-force'
    ) ?? findEvidenceRecord(lauRecords, 'labor-force');
  const lauEmployedRec =
    lauRecords.find(
      (r) => r.variable_name === 'LAU_EMPLOYED' || r.metric_id === 'employed-count'
    ) ?? findEvidenceRecord(lauRecords, 'employed-count');
  const lauUnemployedRec =
    lauRecords.find(
      (r) => r.variable_name === 'LAU_UNEMPLOYED' || r.metric_id === 'unemployed-count'
    ) ?? findEvidenceRecord(lauRecords, 'unemployed-count');

  const lauRateVal = lauRateRec ? getNumericEstimateValue(lauRateRec.estimate) : undefined;
  const unempStatus: WorkforceUnemploymentSummary['unemployment_status'] =
    lauRateVal === undefined
      ? 'unavailable'
      : lauRateVal < 4.0
        ? 'low'
        : lauRateVal <= 6.0
          ? 'moderate'
          : lauRateVal <= 8.0
            ? 'elevated'
            : 'high';

  const periodMatch = lauRateRec?.evidence_id.match(/M[0-9]{2}/) ?? ['M06'];
  const yearMatch = lauRateRec?.evidence_id.match(/20[0-9]{2}/) ?? ['2024'];

  const unemploymentDynamics: WorkforceUnemploymentSummary = {
    series_id: undefined,
    period: periodMatch[0] as WorkforceUnemploymentSummary['period'],
    year: yearMatch[0],
    civilian_labor_force:
      lauLaborForceRec?.estimate ??
      unavail('Civilian labor force estimate not provided in LAU evidence'),
    employed_count:
      lauEmployedRec?.estimate ??
      unavail('Resident employment estimate not provided in LAU evidence'),
    unemployed_count:
      lauUnemployedRec?.estimate ??
      unavail('Resident unemployment estimate not provided in LAU evidence'),
    unemployment_rate_pct:
      lauRateRec?.estimate ?? unavail('Unemployment rate estimate not provided in LAU evidence'),
    monthly_change_pct_points: null,
    unemployment_status: unempStatus,
  };

  // 5. Source-Linked Disagreements
  const disagreements = [];
  if (lauEmployedRec && localTotalEmpRec) {
    const dis = evaluateSourceLinkedDisagreement({
      disagreementId: `dis-wf-emp-${socCode}-${Date.parse(clockTimestamp)}`,
      indicatorKey: 'employment_survey_divergence',
      disagreementType: 'cross_source_divergence',
      expectedMetric: 'LAU Civilian Resident Employment',
      expectedVariableLink: makeVarLink(lauEmployedRec, 'LAU Vintage'),
      expectedDescription: 'Monthly resident civilian employment from BLS LAU model/survey',
      expectedEstimate: lauEmployedRec.estimate,
      expectedProvenance: lauEmployedRec.provenance,
      observedMetric: 'OEWS Total Non-Farm Payroll Employment',
      observedVariableLink: makeVarLink(localTotalEmpRec, 'OEWS Vintage'),
      observedDescription: 'Annual non-farm establishment payroll employment from BLS OEWS survey',
      observedEstimate: localTotalEmpRec.estimate,
      observedProvenance: localTotalEmpRec.provenance,
      warningThreshold: 0.2,
      criticalThreshold: 0.4,
    });
    if (dis) disagreements.push(dis);
  }

  if (hourlyPercentiles.median.status === 'available' && benchmarkMedianRec) {
    const wageDis = evaluateSourceLinkedDisagreement({
      disagreementId: `dis-wf-wage-${socCode}-${Date.parse(clockTimestamp)}`,
      indicatorKey: 'median_wage_disparity',
      disagreementType: 'cross_source_divergence',
      expectedMetric: 'National Benchmark Median Hourly Wage',
      expectedVariableLink: makeVarLink(benchmarkMedianRec, 'OEWS Benchmark Vintage'),
      expectedDescription: 'National OEWS median hourly wage rate for benchmark comparison',
      expectedEstimate: benchmarkMedianRec.estimate,
      expectedProvenance: benchmarkMedianRec.provenance,
      observedMetric: 'Local Median Hourly Wage',
      observedVariableLink: {
        source_id: 'bls-oews',
        variable_id: 'H_MEDIAN',
        metric_id: 'hourly-median-wage',
        vintage: 'Local Vintage',
        attribution: 'BLS OEWS',
      },
      observedDescription: `Local OEWS median hourly wage rate for SOC ${socCode}`,
      observedEstimate: hourlyPercentiles.median,
      observedProvenance: benchmarkMedianRec.provenance,
      warningThreshold: 0.3,
      criticalThreshold: 0.5,
    });
    if (wageDis) disagreements.push(wageDis);
  }

  const disagreementState = createDisagreementState(disagreements);

  // 6. Evidence Bundle Synthesis
  const combinedRecords = [...oewsRecords, ...lauRecords];
  const primaryProvenance: DataProvenance =
    combinedRecords[0]?.provenance ?? createDefaultSynthesisProvenance(clockTimestamp);
  const evidenceBundle: EconomicEvidenceBundle =
    combinedRecords.length > 0
      ? synthesizeMultiSourceEvidenceBundle({
          bundleId: `bundle-${analysisId}`,
          tenantId,
          title: `Workforce Evidence Bundle: SOC ${socCode} in ${input.target_geography.name ?? 'Target Geography'}`,
          targetGeography: input.target_geography,
          records: combinedRecords,
          isoTimestamp: clockTimestamp,
          primaryProvenance,
        })
      : {
          bundle_id: `bundle-${analysisId}`,
          tenant_id: tenantId,
          title: `Empty Workforce Evidence Bundle: SOC ${socCode}`,
          target_geography: input.target_geography,
          records: [],
          created_at: clockTimestamp,
          provenance: primaryProvenance,
        };

  const result: WorkforceAnalysisResult = {
    schema_version: ECONOMIC_SCHEMA_VERSION,
    analysis_id: analysisId,
    tenant_id: tenantId,
    target_geography: input.target_geography,
    soc_code: socCode,
    occupation_title: occupationTitle,
    analyzed_at: clockTimestamp,
    signal_type: 'aggregate_labor_market_survey_signal',
    labor_market_concentration: concentration,
    wage_differentials: wageDifferentials,
    occupational_specialization: occupationalSpecialization,
    unemployment_dynamics: unemploymentDynamics,
    disagreement_state: disagreementState,
    evidence_bundle: evidenceBundle,
    provenance: primaryProvenance,
    disclaimer: WORKFORCE_LABOR_MARKET_SIGNAL_DISCLAIMER,
    legal_disclaimer: ECONOMIC_LEGAL_DISCLAIMER,
  };

  return result;
}
