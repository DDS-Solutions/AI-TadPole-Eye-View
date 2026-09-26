import type {
  DataProvenance,
  EconomicEvidenceBundle,
  EconomicEvidenceRecord,
  EconomicGeography,
} from '@gev/contracts';

// ============================================================================
// Multi-Source Evidence Bundle Synthesis (ACS, CBP/ZBP, OSM POIs)
// ============================================================================

export interface MultiSourceEvidenceBundleParams {
  bundleId: string;
  tenantId: string;
  title: string;
  targetGeography: EconomicGeography;
  records: readonly EconomicEvidenceRecord[];
  isoTimestamp: string;
  primaryProvenance?: DataProvenance;
}

/**
 * Pure function synthesizing an EconomicEvidenceBundle across disparate sources
 * (e.g. Census ACS, Census CBP/ZBP, and OSM Commercial POIs).
 * Preserves source variable links, individual record provenances, and attaches validated bundle provenance.
 */
export function synthesizeMultiSourceEvidenceBundle(
  params: MultiSourceEvidenceBundleParams
): EconomicEvidenceBundle {
  if (params.records.length === 0) {
    throw new RangeError('Evidence bundle requires at least one evidence record');
  }

  const primaryProvenance: DataProvenance = params.primaryProvenance ??
    params.records[0]?.provenance ?? {
      schema_version: 1,
      source: {
        provider_id: 'economic-analysis-engine',
        feed_id: 'multi-source-synthesis',
        name: 'GEV Multi-Source Economic Synthesis Engine',
        canonical_url: 'https://gev.dds-solutions.internal/economic',
      },
      retrieved_at: params.isoTimestamp,
      observation_period: {
        status: 'available',
        start: params.isoTimestamp,
        end: params.isoTimestamp,
      },
      vintage: { status: 'available', value: 'Current Multi-Source Synthesis' },
      mode: 'seed',
      source_mode: 'seed',
      license: {
        id: 'internal-decision-support',
        name: 'Internal Decision Support Only',
      },
      attribution: 'DDS-Solutions Multi-Source Economic Intelligence Engine',
      fixture_id: 'multi-source-synthetic-v1',
      cache: null,
      freshness: { status: 'fresh', age_seconds: 0, fresh_for_seconds: 86400 },
    };

  const bundle: EconomicEvidenceBundle = {
    bundle_id: params.bundleId,
    tenant_id: params.tenantId,
    title: params.title,
    target_geography: params.targetGeography,
    records: [...params.records],
    created_at: params.isoTimestamp,
    provenance: primaryProvenance,
  };

  return bundle;
}

/**
 * Creates default compliant synthesis provenance when no records are available.
 */
export function createDefaultSynthesisProvenance(isoTimestamp: string): DataProvenance {
  return {
    schema_version: 1,
    source: {
      provider_id: 'economic-analysis-engine',
      feed_id: 'multi-source-synthesis',
      name: 'GEV Multi-Source Economic Synthesis Engine',
      canonical_url: 'https://gev.dds-solutions.internal/economic',
    },
    retrieved_at: isoTimestamp,
    observation_period: {
      status: 'available',
      start: isoTimestamp,
      end: isoTimestamp,
    },
    vintage: { status: 'available', value: 'Current Multi-Source Synthesis' },
    mode: 'seed',
    source_mode: 'seed',
    license: {
      id: 'internal-decision-support',
      name: 'Internal Decision Support Only',
    },
    attribution: 'DDS-Solutions Multi-Source Economic Intelligence Engine',
    fixture_id: 'multi-source-synthetic-v1',
    cache: null,
    freshness: { status: 'fresh', age_seconds: 0, fresh_for_seconds: 86400 },
  };
}

/**
 * Pure helper to locate an evidence record by metric_id from a collection.
 */
export function findEvidenceRecord(
  records: readonly EconomicEvidenceRecord[],
  metricId: string
): EconomicEvidenceRecord | undefined {
  return records.find((r) => r.metric_id === metricId);
}
