import {
  ECONOMIC_LEGAL_DISCLAIMER,
  ECONOMIC_SCHEMA_VERSION,
  type EconomicEstimate,
  type MarketAnalysisInput,
  MarketAnalysisInputSchema,
  type MarketAnalysisResult,
  MarketAnalysisResultSchema,
  type MarketBusinessSummary,
  type MarketCommercialFootprintSummary,
  type MarketDemographicSummary,
  type MarketDerivedMetrics,
  type MarketTopCategory,
  type SourceLinkedDisagreement,
  getNumericEstimateValue,
} from '@gev/contracts';
import { createDisagreementState, evaluateSourceLinkedDisagreement } from './disagreementState.js';
import {
  createDefaultSynthesisProvenance,
  findEvidenceRecord,
  synthesizeMultiSourceEvidenceBundle,
} from './multiSourceEvidence.js';

// ============================================================================
// Pure Market Analysis Engine (PLAN.md §8.2, §9.4, ADR 0058)
// ============================================================================

export function analyzeMarketContext(
  input: MarketAnalysisInput,
  clockTimestamp: string
): MarketAnalysisResult {
  const validatedInput = MarketAnalysisInputSchema.parse(input);
  const analysisId = validatedInput.analysis_id ?? `mkt-${Date.parse(clockTimestamp)}`;

  // 1. Demographic metrics (from ACS evidence)
  const popRecord = findEvidenceRecord(validatedInput.acs_evidence, 'total-population');
  const incomeRecord = findEvidenceRecord(validatedInput.acs_evidence, 'median-household-income');
  const povertyRecord = findEvidenceRecord(validatedInput.acs_evidence, 'poverty-population');
  const bachelorsRecord = findEvidenceRecord(
    validatedInput.acs_evidence,
    'bachelors-degree-population'
  );

  const demographics: MarketDemographicSummary = {
    total_population: popRecord?.estimate ?? {
      status: 'unavailable',
      reason: 'Total population metric not provided in ACS evidence',
    },
    median_household_income: incomeRecord?.estimate ?? {
      status: 'unavailable',
      reason: 'Median household income not provided in ACS evidence',
    },
    poverty_rate_pct: povertyRecord?.estimate ?? {
      status: 'unavailable',
      reason: 'Poverty metric not provided in ACS evidence',
    },
    bachelors_degree_rate_pct: bachelorsRecord?.estimate ?? {
      status: 'unavailable',
      reason: 'Bachelors degree metric not provided in ACS evidence',
    },
  };

  // 2. Business activity metrics (from CBP/ZBP evidence)
  const estabRecord =
    findEvidenceRecord(validatedInput.cbp_evidence, 'establishment-count') ??
    findEvidenceRecord(validatedInput.cbp_evidence, 'total-establishments');
  const empRecord =
    findEvidenceRecord(validatedInput.cbp_evidence, 'paid-employment') ??
    findEvidenceRecord(validatedInput.cbp_evidence, 'total-employment');
  const payRecord =
    findEvidenceRecord(validatedInput.cbp_evidence, 'annual-payroll') ??
    findEvidenceRecord(validatedInput.cbp_evidence, 'total-payroll');

  // Compute average annual wage safely without zero coercion
  let avgWageEstimate: EconomicEstimate;
  const payVal = payRecord ? getNumericEstimateValue(payRecord.estimate) : undefined;
  const empVal = empRecord ? getNumericEstimateValue(empRecord.estimate) : undefined;

  if (payVal !== undefined && empVal !== undefined && empVal > 0) {
    const annualPayrollDollars = payVal * 1000; // CBP PAYANN is in thousands
    const wage = Math.round((annualPayrollDollars / empVal) * 100) / 100;
    avgWageEstimate = {
      status: 'available',
      value: wage,
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
      unit: 'USD',
    };
  } else if (payRecord?.estimate.status === 'suppressed') {
    avgWageEstimate = {
      status: 'suppressed',
      reason: payRecord.estimate.reason,
      detail: 'Average wage suppressed due to payroll disclosure avoidance',
    };
  } else if (empRecord?.estimate.status === 'suppressed') {
    avgWageEstimate = {
      status: 'suppressed',
      reason: empRecord.estimate.reason,
      detail: 'Average wage suppressed due to employment disclosure avoidance',
    };
  } else {
    avgWageEstimate = {
      status: 'unavailable',
      reason: 'Annual payroll or employment unavailable to calculate average wage',
    };
  }

  const businessActivity: MarketBusinessSummary = {
    total_establishments: estabRecord?.estimate ?? {
      status: 'unavailable',
      reason: 'Establishment count not provided in CBP evidence',
    },
    paid_employment: empRecord?.estimate ?? {
      status: 'unavailable',
      reason: 'Paid employment not provided in CBP evidence',
    },
    annual_payroll_usd_thousands: payRecord?.estimate ?? {
      status: 'unavailable',
      reason: 'Annual payroll not provided in CBP evidence',
    },
    average_annual_wage_usd: avgWageEstimate,
  };

  // 3. Commercial footprint metrics (from OSM)
  const footprint = validatedInput.osm_footprint;
  const topCats: MarketTopCategory[] = footprint
    ? (Object.entries(footprint.category_counts)
        .map(([cat, count]) => ({
          category: cat as MarketTopCategory['category'],
          count,
        }))
        .filter((c) => c.count > 0)
        .slice(0, 10) as MarketTopCategory[])
    : [];

  const commercialFootprint: MarketCommercialFootprintSummary = {
    commercial_poi_count: footprint
      ? {
          status: 'available',
          value: footprint.total_features,
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
          unit: 'poi_count',
        }
      : {
          status: 'unavailable',
          reason: 'OSM commercial footprint not provided in query input',
        },
    commercial_density_per_km2: footprint
      ? {
          status: 'available',
          value: footprint.density_per_km2,
          margin_of_error: null,
          confidence_level: null,
          sample_size: null,
          unit: 'poi_per_km2',
        }
      : {
          status: 'unavailable',
          reason: 'OSM commercial density not provided in query input',
        },
    top_categories: topCats,
  };

  // 4. Derived metrics (population per establishment, establishments per 10k)
  const popVal = getNumericEstimateValue(demographics.total_population);
  const estabVal = getNumericEstimateValue(businessActivity.total_establishments);

  let popPerEstab: EconomicEstimate;
  let estabPer10k: EconomicEstimate;

  if (popVal !== undefined && estabVal !== undefined && estabVal > 0) {
    popPerEstab = {
      status: 'available',
      value: Math.round((popVal / estabVal) * 10) / 10,
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
      unit: 'persons_per_establishment',
    };
    estabPer10k = {
      status: 'available',
      value: Math.round((estabVal / popVal) * 10000 * 10) / 10,
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
      unit: 'establishments_per_10k',
    };
  } else if (businessActivity.total_establishments.status === 'suppressed') {
    popPerEstab = {
      status: 'suppressed',
      reason: 'disclosure_avoidance',
      detail: 'Population per establishment suppressed due to suppressed establishment count',
    };
    estabPer10k = {
      status: 'suppressed',
      reason: 'disclosure_avoidance',
      detail: 'Establishment density suppressed due to suppressed establishment count',
    };
  } else {
    popPerEstab = {
      status: 'unavailable',
      reason: 'Population or establishment count unavailable to calculate ratio',
    };
    estabPer10k = {
      status: 'unavailable',
      reason: 'Population or establishment count unavailable to calculate ratio',
    };
  }

  const derivedMetrics: MarketDerivedMetrics = {
    population_per_establishment: popPerEstab,
    establishments_per_10k_residents: estabPer10k,
    commercial_coverage_ratio: commercialFootprint.commercial_density_per_km2,
  };

  // 5. Evaluate disagreements & cross-source divergence
  const disagreements: SourceLinkedDisagreement[] = [];

  // Check expected benchmark density vs observed density
  if (validatedInput.benchmark_density_expectation !== undefined && footprint && popRecord) {
    const expectedEstimate: EconomicEstimate = {
      status: 'available',
      value: validatedInput.benchmark_density_expectation,
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
      unit: 'poi_per_km2',
    };
    const dis = evaluateSourceLinkedDisagreement({
      disagreementId: `dis-density-${analysisId}`,
      indicatorKey: 'commercial_density',
      disagreementType: 'prediction_vs_observation',
      expectedMetric: 'benchmark-density-expectation',
      expectedVariableLink: {
        source_id: 'gev-economic-model',
        variable_id: 'BENCHMARK_DENSITY',
        metric_id: 'commercial-density-expectation',
        vintage: '2026-Q3-Benchmark',
        attribution: 'GEV Economic Model Benchmark',
      },
      expectedDescription: 'Model expected commercial density benchmark',
      expectedEstimate,
      expectedProvenance: popRecord.provenance,
      observedMetric: 'osm-commercial-density',
      observedVariableLink: {
        source_id: 'osm-commercial',
        variable_id: 'poi_density_km2',
        metric_id: 'commercial-density-per-km2',
        vintage: '2026-OSM-Extraction',
        attribution: '© OpenStreetMap contributors (ODbL 1.0)',
      },
      observedDescription: 'Observed commercial POI density per km²',
      observedEstimate: commercialFootprint.commercial_density_per_km2,
      observedProvenance: validatedInput.osm_evidence?.[0]?.provenance ?? popRecord.provenance,
    });
    if (dis) disagreements.push(dis);
  }

  // Check CBP establishments vs OSM commercial POIs (cross-source divergence)
  if (estabRecord && footprint) {
    const dis = evaluateSourceLinkedDisagreement({
      disagreementId: `dis-estab-osm-${analysisId}`,
      indicatorKey: 'establishment_count_vs_poi_count',
      disagreementType: 'cross_source_divergence',
      expectedMetric: 'census-cbp-establishments',
      expectedVariableLink: {
        source_id: estabRecord.source_id,
        variable_id: estabRecord.variable_name,
        metric_id: estabRecord.metric_id,
        vintage:
          estabRecord.provenance.vintage.status === 'available'
            ? estabRecord.provenance.vintage.value
            : '2023',
        attribution: estabRecord.provenance.attribution,
      },
      expectedDescription: 'CBP reported administrative establishment count',
      expectedEstimate: estabRecord.estimate,
      expectedProvenance: estabRecord.provenance,
      observedMetric: 'osm-commercial-poi-count',
      observedVariableLink: {
        source_id: 'osm-commercial',
        variable_id: 'total_commercial_features',
        metric_id: 'commercial-poi-count',
        vintage: '2026-OSM-Extraction',
        attribution: '© OpenStreetMap contributors (ODbL 1.0)',
      },
      observedDescription: 'OSM observed commercial POI count',
      observedEstimate: commercialFootprint.commercial_poi_count,
      observedProvenance: validatedInput.osm_evidence?.[0]?.provenance ?? estabRecord.provenance,
      warningThreshold: 0.25,
      criticalThreshold: 0.5,
    });
    if (dis) disagreements.push(dis);
  }

  // 6. Build evidence bundle
  const allRecords = [
    ...validatedInput.acs_evidence,
    ...validatedInput.cbp_evidence,
    ...(validatedInput.osm_evidence ?? []),
  ];

  if (allRecords.length === 0) {
    allRecords.push({
      evidence_id: `ev-unavail-${analysisId}`,
      source_id: 'economic-analysis-engine',
      metric_id: 'market-analysis-unavailable',
      variable_name: 'UNAVAILABLE',
      label: 'No Evidence Records Available',
      geography: validatedInput.target_geography,
      estimate: {
        status: 'unavailable',
        reason: 'No evidence records provided in input query',
      },
      provenance: createDefaultSynthesisProvenance(clockTimestamp),
    });
  }

  const primaryProv = allRecords[0]?.provenance;
  const bundle = synthesizeMultiSourceEvidenceBundle({
    bundleId: `bundle-${analysisId}`,
    tenantId: validatedInput.tenant_id,
    title: `Market Analysis Evidence Bundle — ${analysisId}`,
    targetGeography: validatedInput.target_geography,
    records: allRecords,
    isoTimestamp: clockTimestamp,
    primaryProvenance: primaryProv,
  });

  const result: MarketAnalysisResult = {
    schema_version: ECONOMIC_SCHEMA_VERSION,
    analysis_id: analysisId,
    tenant_id: validatedInput.tenant_id,
    target_geography: validatedInput.target_geography,
    analyzed_at: clockTimestamp,
    demographics,
    business_activity: businessActivity,
    commercial_footprint: commercialFootprint,
    derived_metrics: derivedMetrics,
    disagreement_state: createDisagreementState(disagreements),
    evidence_bundle: bundle,
    provenance: bundle.provenance,
    disclaimer: ECONOMIC_LEGAL_DISCLAIMER,
  };

  return MarketAnalysisResultSchema.parse(result);
}
