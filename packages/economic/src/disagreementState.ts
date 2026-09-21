import {
  type DataProvenance,
  type DisagreementSeverity,
  type DisagreementState,
  type DisagreementType,
  type EconomicEstimate,
  type SourceLinkedDisagreement,
  type SourceVariableLink,
  getNumericEstimateValue,
} from '@gev/contracts';

// ============================================================================
// Source-Linked Disagreement Evaluation & Preservation (PLAN.md §8.2, §8.3, §9.4)
// ============================================================================

export interface EvaluateSourceDisagreementParams {
  disagreementId: string;
  indicatorKey: string;
  disagreementType: DisagreementType;
  expectedMetric: string;
  expectedVariableLink: SourceVariableLink;
  expectedDescription: string;
  expectedEstimate: EconomicEstimate;
  expectedProvenance: DataProvenance;
  observedMetric: string;
  observedVariableLink: SourceVariableLink;
  observedDescription: string;
  observedEstimate: EconomicEstimate;
  observedProvenance: DataProvenance;
  warningThreshold?: number;
  criticalThreshold?: number;
}

/**
 * Pure evaluation function comparing an expected signal with an observed signal.
 * When signals conflict, both are preserved with explicit source links and provenance.
 * NEVER overwrites, averages, or silently discards contradictory evidence.
 */
export function evaluateSourceLinkedDisagreement(
  params: EvaluateSourceDisagreementParams
): SourceLinkedDisagreement | null {
  const expectedVal = getNumericEstimateValue(params.expectedEstimate);
  const observedVal = getNumericEstimateValue(params.observedEstimate);

  if (expectedVal !== undefined && observedVal !== undefined) {
    const warningThresh = params.warningThreshold ?? 0.15;
    const criticalThresh = params.criticalThreshold ?? 0.35;
    const baseline = Math.abs(expectedVal) > 1e-6 ? Math.abs(expectedVal) : 1;
    const absoluteDelta = Math.abs(observedVal - expectedVal);
    const relativeDelta = absoluteDelta / baseline;

    if (relativeDelta >= warningThresh) {
      const severity: DisagreementSeverity =
        relativeDelta >= criticalThresh ? 'critical' : 'warning';
      const pct = Math.round(relativeDelta * 1000) / 10;
      const direction = observedVal > expectedVal ? 'observed_higher' : 'observed_lower';
      const deltaDescription = `Observed value (${observedVal}) is ${pct}% ${
        observedVal > expectedVal ? 'higher' : 'lower'
      } than expected benchmark (${expectedVal})`;

      return {
        disagreement_id: params.disagreementId,
        indicator_key: params.indicatorKey,
        disagreement_type: params.disagreementType,
        severity,
        expected_signal: {
          source_metric: params.expectedMetric,
          variable_link: params.expectedVariableLink,
          description: params.expectedDescription,
          estimate: params.expectedEstimate,
          provenance: params.expectedProvenance,
        },
        observed_signal: {
          source_metric: params.observedMetric,
          variable_link: params.observedVariableLink,
          description: params.observedDescription,
          estimate: params.observedEstimate,
          provenance: params.observedProvenance,
        },
        delta_metrics: {
          absolute_delta: Math.round(absoluteDelta * 100) / 100,
          relative_delta_pct: pct,
          direction,
        },
        resolution_state: 'unresolved_preserved',
        delta_description: deltaDescription,
      };
    }
    return null;
  }

  // Handle status divergence (e.g. one available, other suppressed/unavailable)
  if (params.expectedEstimate.status !== params.observedEstimate.status) {
    return {
      disagreement_id: params.disagreementId,
      indicator_key: params.indicatorKey,
      disagreement_type: 'status_disparity',
      severity: 'info',
      expected_signal: {
        source_metric: params.expectedMetric,
        variable_link: params.expectedVariableLink,
        description: params.expectedDescription,
        estimate: params.expectedEstimate,
        provenance: params.expectedProvenance,
      },
      observed_signal: {
        source_metric: params.observedMetric,
        variable_link: params.observedVariableLink,
        description: params.observedDescription,
        estimate: params.observedEstimate,
        provenance: params.observedProvenance,
      },
      delta_metrics: {
        absolute_delta: null,
        relative_delta_pct: null,
        direction: 'status_divergence',
      },
      resolution_state: 'unresolved_preserved',
      delta_description: `Status disparity: expected ${params.expectedEstimate.status}, observed ${params.observedEstimate.status}`,
    };
  }

  return null;
}

export function createDisagreementState(
  records: readonly SourceLinkedDisagreement[]
): DisagreementState {
  const counts = { info: 0, warning: 0, critical: 0 };
  for (const r of records) {
    counts[r.severity]++;
  }
  return {
    has_disagreements: records.length > 0,
    total_disagreements: records.length,
    by_severity: counts,
    records: [...records],
  };
}
