import {
  type CompetitionAnalysisInput,
  CompetitionAnalysisInputSchema,
  type CompetitionAnalysisResult,
  CompetitionAnalysisResultSchema,
  ECONOMIC_LEGAL_DISCLAIMER,
  ECONOMIC_SCHEMA_VERSION,
  type EconomicEstimate,
  type HhiConcentrationResult,
  type SourceLinkedDisagreement,
} from '@gev/contracts';
import { calculateHhiFromShares, calculateHhiFromValues } from './concentration.js';
import { createDisagreementState, evaluateSourceLinkedDisagreement } from './disagreementState.js';
import {
  createDefaultSynthesisProvenance,
  findEvidenceRecord,
  synthesizeMultiSourceEvidenceBundle,
} from './multiSourceEvidence.js';

// ============================================================================
// Pure Competition Analysis Engine (PLAN.md §8.2, §9.4, ADR 0058)
// ============================================================================

export function analyzeCompetition(
  input: CompetitionAnalysisInput,
  clockTimestamp: string
): CompetitionAnalysisResult {
  const validatedInput = CompetitionAnalysisInputSchema.parse(input);
  const analysisId = validatedInput.analysis_id ?? `comp-${Date.parse(clockTimestamp)}`;

  // 1. Calculate HHI Concentration
  let hhiResult: HhiConcentrationResult;
  if (validatedInput.firm_shares_or_sizes && validatedInput.firm_shares_or_sizes.length > 0) {
    hhiResult = calculateHhiFromValues(validatedInput.firm_shares_or_sizes);
  } else {
    const count = validatedInput.osm_poi_features.length;
    if (count > 0) {
      const equalShare = 100 / count;
      const shares = new Array(count).fill(equalShare);
      hhiResult = calculateHhiFromShares(shares);
    } else {
      hhiResult = {
        hhi: 0,
        tier: 'unconcentrated',
        firm_count: 0,
        top_share_pct: 0,
      };
    }
  }

  // 2. Reported establishments from CBP
  const estabRecord =
    findEvidenceRecord(validatedInput.cbp_evidence, 'establishment-count') ??
    findEvidenceRecord(validatedInput.cbp_evidence, 'total-establishments') ??
    validatedInput.cbp_evidence[0];

  const reportedEstabs: EconomicEstimate = estabRecord?.estimate ?? {
    status: 'unavailable',
    reason: 'CBP establishment count not provided for NAICS',
  };

  // 3. Observed competitors from OSM POIs
  const observedCount = validatedInput.osm_poi_features.length;
  const observedCompetitors: EconomicEstimate = {
    status: 'available',
    value: observedCount,
    margin_of_error: null,
    confidence_level: null,
    sample_size: null,
    unit: 'poi_count',
  };

  // 4. Competitor density
  const areaKm2 = validatedInput.osm_footprint?.area_km2;
  let competitorDensity: EconomicEstimate;
  if (areaKm2 !== undefined && areaKm2 > 0) {
    competitorDensity = {
      status: 'available',
      value: Math.round((observedCount / areaKm2) * 100) / 100,
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
      unit: 'competitors_per_km2',
    };
  } else {
    competitorDensity = {
      status: 'unavailable',
      reason: 'Area in square kilometers not available from footprint',
    };
  }

  // 5. Competitor share of commercial footprint
  const totalCommercialPoi = validatedInput.osm_footprint?.total_features;
  let competitorShare: EconomicEstimate;
  if (totalCommercialPoi !== undefined && totalCommercialPoi > 0) {
    competitorShare = {
      status: 'available',
      value: Math.round((observedCount / totalCommercialPoi) * 1000) / 10,
      margin_of_error: null,
      confidence_level: null,
      sample_size: null,
      unit: 'percent',
    };
  } else {
    competitorShare = {
      status: 'unavailable',
      reason: 'Total commercial features not available from footprint',
    };
  }

  // 6. Cross-source disagreement evaluation
  const disagreements: SourceLinkedDisagreement[] = [];
  if (estabRecord) {
    const dis = evaluateSourceLinkedDisagreement({
      disagreementId: `dis-comp-${analysisId}`,
      indicatorKey: 'competitor_count_divergence',
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
      expectedDescription: `Reported establishments for NAICS ${validatedInput.naics_code}`,
      expectedEstimate: reportedEstabs,
      expectedProvenance: estabRecord.provenance,
      observedMetric: 'osm-observed-competitors',
      observedVariableLink: {
        source_id: 'osm-commercial',
        variable_id: 'competitor_poi_count',
        metric_id: 'observed-poi-competitors',
        vintage: '2026-OSM-Extraction',
        attribution: '© OpenStreetMap contributors (ODbL 1.0)',
      },
      observedDescription: `Observed OSM commercial competitors for ${validatedInput.industry_title}`,
      observedEstimate: observedCompetitors,
      observedProvenance: estabRecord.provenance,
      warningThreshold: 0.2,
      criticalThreshold: 0.4,
    });
    if (dis) disagreements.push(dis);
  }

  // 7. Evidence bundle
  const records = [...validatedInput.cbp_evidence];
  if (records.length === 0) {
    records.push({
      evidence_id: `ev-unavail-${analysisId}`,
      source_id: 'economic-analysis-engine',
      metric_id: 'competition-evidence-unavailable',
      variable_name: 'UNAVAILABLE',
      label: 'No Competition Evidence Records Available',
      geography: validatedInput.target_geography,
      estimate: {
        status: 'unavailable',
        reason: 'No CBP evidence records provided for competition analysis',
      },
      provenance: createDefaultSynthesisProvenance(clockTimestamp),
    });
  }

  const bundle = synthesizeMultiSourceEvidenceBundle({
    bundleId: `bundle-${analysisId}`,
    tenantId: validatedInput.tenant_id,
    title: `Competition Analysis Evidence Bundle — ${analysisId}`,
    targetGeography: validatedInput.target_geography,
    records,
    isoTimestamp: clockTimestamp,
  });

  const result: CompetitionAnalysisResult = {
    schema_version: ECONOMIC_SCHEMA_VERSION,
    analysis_id: analysisId,
    tenant_id: validatedInput.tenant_id,
    target_geography: validatedInput.target_geography,
    naics_code: validatedInput.naics_code,
    industry_title: validatedInput.industry_title,
    analyzed_at: clockTimestamp,
    concentration: hhiResult,
    reported_establishments: reportedEstabs,
    observed_poi_competitors: observedCompetitors,
    competitor_density_per_km2: competitorDensity,
    competitor_share_of_commercial_footprint_pct: competitorShare,
    disagreement_state: createDisagreementState(disagreements),
    evidence_bundle: bundle,
    provenance: bundle.provenance,
    disclaimer: ECONOMIC_LEGAL_DISCLAIMER,
  };

  return CompetitionAnalysisResultSchema.parse(result);
}
