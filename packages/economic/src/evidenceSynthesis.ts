import {
  type BusinessContextInput,
  type BusinessContextPreview,
  type DataProvenance,
  type DisagreementSeverity,
  ECONOMIC_LEGAL_DISCLAIMER,
  ECONOMIC_SCHEMA_VERSION,
  type EconomicDisagreement,
  type EconomicEstimate,
  type EconomicEvidenceRecord,
  getNumericEstimateValue,
} from '@gev/contracts';

export interface EvaluateDisagreementOptions {
  relativeWarningThreshold?: number; // e.g. 0.15 (15%)
  relativeCriticalThreshold?: number; // e.g. 0.35 (35%)
}

/**
 * Pure evaluation function comparing an expected baseline estimate with an observed estimate.
 * Returns an EconomicDisagreement record if the difference exceeds thresholds, or null if consistent.
 * NEVER overwrites or silences contradictory signals.
 */
export function evaluateEvidenceDisagreement(
  expectedSource: string,
  expectedDescription: string,
  expectedEstimate: EconomicEstimate,
  observedSource: string,
  observedDescription: string,
  observedEstimate: EconomicEstimate,
  options: EvaluateDisagreementOptions = {}
): EconomicDisagreement | null {
  const expectedVal = getNumericEstimateValue(expectedEstimate);
  const observedVal = getNumericEstimateValue(observedEstimate);

  // If either value is suppressed or unavailable, compare status compatibility
  if (expectedVal === undefined || observedVal === undefined) {
    if (expectedEstimate.status !== observedEstimate.status) {
      return {
        status: 'disagreement',
        expected: {
          source_metric: expectedSource,
          description: expectedDescription,
          estimate: expectedEstimate,
        },
        observed: {
          source_metric: observedSource,
          description: observedDescription,
          estimate: observedEstimate,
        },
        delta_description: `Status disparity: expected ${expectedEstimate.status}, observed ${observedEstimate.status}`,
        severity: 'info',
      };
    }
    return null;
  }

  const warningThresh = options.relativeWarningThreshold ?? 0.15;
  const criticalThresh = options.relativeCriticalThreshold ?? 0.35;

  const baseline = Math.abs(expectedVal) > 1e-6 ? Math.abs(expectedVal) : 1;
  const absoluteDelta = Math.abs(observedVal - expectedVal);
  const relativeDelta = absoluteDelta / baseline;

  if (relativeDelta >= warningThresh) {
    let severity: DisagreementSeverity = 'warning';
    if (relativeDelta >= criticalThresh) {
      severity = 'critical';
    }

    const pct = Math.round(relativeDelta * 1000) / 10;
    const direction = observedVal > expectedVal ? 'higher' : 'lower';
    const deltaDescription = `Observed value (${observedVal}) is ${pct}% ${direction} than model benchmark (${expectedVal})`;

    return {
      status: 'disagreement',
      expected: {
        source_metric: expectedSource,
        description: expectedDescription,
        estimate: expectedEstimate,
      },
      observed: {
        source_metric: observedSource,
        description: observedDescription,
        estimate: observedEstimate,
      },
      delta_description: deltaDescription,
      severity,
    };
  }

  return null;
}

export interface SynthesizePreviewParams {
  previewId: string;
  tenantId: string;
  isoTimestamp: string;
  input: BusinessContextInput;
  evidence: readonly EconomicEvidenceRecord[];
  summaryEstimates: Record<string, EconomicEstimate>;
  provenance?: DataProvenance;
  warnings?: readonly string[];
}

/**
 * Pure function synthesizing a BusinessContextPreview envelope.
 * Strictly enforces legal disclaimers, schema versioning, and zero-coercion semantics.
 */
export function synthesizeBusinessContextPreview(
  params: SynthesizePreviewParams
): BusinessContextPreview {
  const warnings: string[] = params.warnings ? [...params.warnings] : [];

  // Audit for any suppressed metrics and add transparent notice
  for (const [key, est] of Object.entries(params.summaryEstimates)) {
    if (est.status === 'suppressed') {
      warnings.push(`Metric '${key}' is suppressed due to ${est.reason}: ${est.detail}`);
    } else if (est.status === 'unavailable') {
      warnings.push(`Metric '${key}' is currently unavailable: ${est.reason}`);
    }
  }

  // Derive primary provenance from params, evidence or generate default compliant provenance
  const primaryProvenance: DataProvenance = params.provenance ??
    params.evidence[0]?.provenance ?? {
      schema_version: 1,
      source: {
        provider_id: 'economic-analysis-engine',
        feed_id: 'economic-preview',
        name: 'GEV Economic Analysis Engine',
        canonical_url: 'https://gev.dds-solutions.internal/economic',
      },
      retrieved_at: params.isoTimestamp,
      observation_period: {
        status: 'available',
        start: params.isoTimestamp,
        end: params.isoTimestamp,
      },
      vintage: {
        status: 'available',
        value: 'Current Synthesis Cycle',
      },
      mode: 'live',
      source_mode: 'live',
      license: {
        id: 'internal-decision-support',
        name: 'Internal Decision Support Only',
      },
      attribution: 'DDS-Solutions Economic Intelligence Engine',
      fixture_id: null,
      cache: null,
      freshness: {
        status: 'fresh',
        age_seconds: 0,
        fresh_for_seconds: 86400,
      },
    };

  return {
    schema_version: ECONOMIC_SCHEMA_VERSION,
    preview_id: params.previewId,
    tenant_id: params.tenantId,
    generated_at: params.isoTimestamp,
    input: params.input,
    evidence: [...params.evidence],
    summary_estimates: { ...params.summaryEstimates },
    provenance: primaryProvenance,
    warnings,
    disclaimer: ECONOMIC_LEGAL_DISCLAIMER,
  };
}
