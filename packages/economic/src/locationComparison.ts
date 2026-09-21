import {
  ECONOMIC_LEGAL_DISCLAIMER,
  ECONOMIC_SCHEMA_VERSION,
  type EconomicEstimate,
  type EconomicEvidenceRecord,
  type LocationComparisonInput,
  LocationComparisonInputSchema,
  type LocationComparisonMetricRow,
  type LocationComparisonResult,
  type LocationComparisonValue,
  type LocationSpecializationComparison,
  getNumericEstimateValue,
} from '@gev/contracts';
import { createDisagreementState } from './disagreementState.js';
import {
  createDefaultSynthesisProvenance,
  findEvidenceRecord,
  synthesizeMultiSourceEvidenceBundle,
} from './multiSourceEvidence.js';
import { calculateLocationQuotient } from './specialization.js';

// ============================================================================
// Pure Location Comparison Engine (PLAN.md §8.2, §9.4, ADR 0058)
// ============================================================================

export function compareLocations(
  input: LocationComparisonInput,
  clockTimestamp: string
): LocationComparisonResult {
  const validatedInput = LocationComparisonInputSchema.parse(input);
  const comparisonId = validatedInput.comparison_id ?? `cmp-${Date.parse(clockTimestamp)}`;
  const locations = validatedInput.locations;
  const firstLoc = locations[0] ?? {
    location_key: 'default',
    label: 'Default Location',
    geography: { level: 'nation', country_code: 'US' },
    acs_evidence: [],
    cbp_evidence: [],
  };
  const benchmarkKey = validatedInput.benchmark_location_key ?? firstLoc.location_key;

  const benchmarkLoc = locations.find((l) => l.location_key === benchmarkKey) ?? firstLoc;

  // Metrics to compare across locations
  const metricConfigs = [
    {
      metricId: 'total-population',
      label: 'Total Population',
      unit: 'persons',
      extractor: (l: (typeof locations)[0]) =>
        findEvidenceRecord(l.acs_evidence, 'total-population')?.estimate,
    },
    {
      metricId: 'median-household-income',
      label: 'Median Household Income',
      unit: 'USD',
      extractor: (l: (typeof locations)[0]) =>
        findEvidenceRecord(l.acs_evidence, 'median-household-income')?.estimate,
    },
    {
      metricId: 'establishment-count',
      label: 'Total Establishments',
      unit: 'establishments',
      extractor: (l: (typeof locations)[0]) =>
        findEvidenceRecord(l.cbp_evidence, 'establishment-count')?.estimate ??
        findEvidenceRecord(l.cbp_evidence, 'total-establishments')?.estimate,
    },
    {
      metricId: 'commercial-poi-count',
      label: 'Commercial POI Count',
      unit: 'poi_count',
      extractor: (l: (typeof locations)[0]): EconomicEstimate =>
        l.osm_footprint
          ? {
              status: 'available',
              value: l.osm_footprint.total_features,
              margin_of_error: null,
              confidence_level: null,
              sample_size: null,
              unit: 'poi_count',
            }
          : { status: 'unavailable', reason: 'OSM footprint not provided' },
    },
  ];

  const metricRows: LocationComparisonMetricRow[] = metricConfigs.map((cfg) => {
    const benchEst = cfg.extractor(benchmarkLoc) ?? {
      status: 'unavailable',
      reason: 'Metric unavailable for benchmark location',
    };
    const benchVal = getNumericEstimateValue(benchEst);

    // Extract values for all locations
    const values: LocationComparisonValue[] = locations.map((loc) => {
      const est = cfg.extractor(loc) ?? {
        status: 'unavailable',
        reason: 'Metric unavailable for location',
      };
      const val = getNumericEstimateValue(est);

      let relativePct: number | null = null;
      if (val !== undefined && benchVal !== undefined && benchVal > 0) {
        relativePct = Math.round(((val - benchVal) / benchVal) * 1000) / 10;
      }

      return {
        location_key: loc.location_key,
        label: loc.label,
        geography: loc.geography,
        estimate: est,
        relative_to_benchmark_pct: relativePct,
        rank: null,
      };
    });

    // Compute ranks among available numeric values
    const available = values
      .map((v, idx) => ({ idx, val: getNumericEstimateValue(v.estimate) }))
      .filter((item): item is { idx: number; val: number } => item.val !== undefined)
      .sort((a, b) => b.val - a.val);

    available.forEach((item, rankIdx) => {
      const targetVal = values[item.idx];
      if (targetVal) {
        targetVal.rank = rankIdx + 1;
      }
    });

    return {
      metric_id: cfg.metricId,
      label: cfg.label,
      unit: cfg.unit,
      values,
    };
  });

  // Calculate specialization Location Quotients if NAICS provided
  let specializations: LocationSpecializationComparison[] | undefined;
  if (validatedInput.naics_code) {
    const naics = validatedInput.naics_code;
    const benchEmpRecord = findEvidenceRecord(benchmarkLoc.cbp_evidence, 'paid-employment');
    const benchEmpVal = benchEmpRecord
      ? getNumericEstimateValue(benchEmpRecord.estimate)
      : undefined;

    specializations = locations.map((loc) => {
      const locEmpRecord = findEvidenceRecord(loc.cbp_evidence, 'paid-employment');
      const locEmpVal = locEmpRecord ? getNumericEstimateValue(locEmpRecord.estimate) : undefined;

      if (
        locEmpVal !== undefined &&
        benchEmpVal !== undefined &&
        benchEmpVal > 0 &&
        locEmpVal >= 0
      ) {
        const lqResult = calculateLocationQuotient(
          locEmpVal,
          Math.max(locEmpVal, 1000),
          benchEmpVal,
          Math.max(benchEmpVal, 1000)
        );
        return {
          location_key: loc.location_key,
          label: loc.label,
          geography: loc.geography,
          naics_code: naics,
          location_quotient: lqResult.lq,
          tier: lqResult.tier,
        };
      }

      const isSuppressed =
        locEmpRecord?.estimate.status === 'suppressed' ||
        benchEmpRecord?.estimate.status === 'suppressed';

      return {
        location_key: loc.location_key,
        label: loc.label,
        geography: loc.geography,
        naics_code: naics,
        location_quotient: null,
        tier: isSuppressed ? 'suppressed' : 'underrepresented',
      };
    });
  }

  // Combine evidence records
  const allRecords: EconomicEvidenceRecord[] = [];
  for (const loc of locations) {
    allRecords.push(...loc.acs_evidence);
    allRecords.push(...loc.cbp_evidence);
    if (loc.osm_evidence) {
      allRecords.push(...loc.osm_evidence);
    }
  }

  if (allRecords.length === 0) {
    allRecords.push({
      evidence_id: `ev-unavail-${comparisonId}`,
      source_id: 'economic-analysis-engine',
      metric_id: 'location-comparison-unavailable',
      variable_name: 'UNAVAILABLE',
      label: 'No Location Comparison Evidence Available',
      geography: benchmarkLoc.geography,
      estimate: {
        status: 'unavailable',
        reason: 'No evidence records provided across locations',
      },
      provenance: createDefaultSynthesisProvenance(clockTimestamp),
    });
  }

  const bundle = synthesizeMultiSourceEvidenceBundle({
    bundleId: `bundle-${comparisonId}`,
    tenantId: validatedInput.tenant_id,
    title: `Location Comparison Evidence Bundle — ${comparisonId}`,
    targetGeography: benchmarkLoc.geography,
    records: allRecords,
    isoTimestamp: clockTimestamp,
  });

  const result: LocationComparisonResult = {
    schema_version: ECONOMIC_SCHEMA_VERSION,
    comparison_id: comparisonId,
    tenant_id: validatedInput.tenant_id,
    analyzed_at: clockTimestamp,
    benchmark_location_key: benchmarkKey,
    locations: locations.map((l) => ({
      location_key: l.location_key,
      label: l.label,
      geography: l.geography,
    })),
    metrics: metricRows,
    specializations,
    disagreement_state: createDisagreementState([]),
    evidence_bundle: bundle,
    provenance: bundle.provenance,
    disclaimer: ECONOMIC_LEGAL_DISCLAIMER,
  };

  return result;
}
