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
 * Synthesizes bundle provenance from underlying input provenances without inventing
 * seed-mode flags or conflating retrieval timestamps with observation periods.
 */
export function synthesizeAggregateProvenance(
  provenances: readonly DataProvenance[],
  isoTimestamp: string
): DataProvenance {
  if (provenances.length === 0) {
    return createDefaultSynthesisProvenance(isoTimestamp);
  }
  if (provenances.length === 1) {
    return provenances[0]!;
  }

  let earliestStartMs: number | null = null;
  let earliestStartIso: string | null = null;
  let latestEndMs: number | null = null;
  let latestEndIso: string | null = null;

  for (const prov of provenances) {
    if (prov.observation_period.status === 'available') {
      const startMs = Date.parse(prov.observation_period.start);
      const endMs = Date.parse(prov.observation_period.end);
      if (earliestStartMs === null || startMs < earliestStartMs) {
        earliestStartMs = startMs;
        earliestStartIso = prov.observation_period.start;
      }
      if (latestEndMs === null || endMs > latestEndMs) {
        latestEndMs = endMs;
        latestEndIso = prov.observation_period.end;
      }
    }
  }

  const observationPeriod: DataProvenance['observation_period'] =
    earliestStartIso && latestEndIso
      ? { status: 'available', start: earliestStartIso, end: latestEndIso }
      : {
          status: 'unavailable',
          reason: 'Underlying evidence records did not carry available observation periods',
        };

  const vintages = Array.from(
    new Set(
      provenances
        .map((p) => (p.vintage.status === 'available' ? p.vintage.value : null))
        .filter((v): v is string => v !== null)
    )
  );
  const vintage: DataProvenance['vintage'] =
    vintages.length > 0
      ? { status: 'available', value: vintages.slice(0, 3).join('; ').slice(0, 200) }
      : { status: 'unavailable', reason: 'Underlying evidence records lacked vintage metadata' };

  const primary = provenances[0]!;
  const allSeed = provenances.every((p) => p.source_mode === 'seed');
  const allLive = provenances.every((p) => p.source_mode === 'live');
  const allDownloadPack = provenances.every((p) => p.source_mode === 'download_pack');
  const allUnavailable = provenances.every((p) => p.source_mode === 'unavailable');

  const sourceMode: DataProvenance['source_mode'] = allSeed
    ? 'seed'
    : allLive
      ? 'live'
      : allDownloadPack
        ? 'download_pack'
        : allUnavailable
          ? 'unavailable'
          : primary.source_mode;

  const mode: DataProvenance['mode'] =
    sourceMode === 'seed'
      ? 'seed'
      : primary.mode === 'cached' && sourceMode === primary.source_mode && primary.cache !== null
        ? 'cached'
        : sourceMode;

  const fixtureId =
    sourceMode === 'seed' ? (primary.fixture_id ?? 'multi-source-seed-synthesis-v1') : null;
  const cache = mode === 'cached' ? primary.cache : null;

  return {
    schema_version: 1,
    source: {
      provider_id: 'economic-analysis-engine',
      feed_id: 'multi-source-synthesis',
      name: 'GEV Multi-Source Economic Synthesis Engine',
      canonical_url: 'https://gev.dds-solutions.internal/economic',
    },
    retrieved_at: isoTimestamp,
    observation_period: observationPeriod,
    vintage,
    mode,
    source_mode: sourceMode,
    license: primary.license,
    attribution: Array.from(new Set(provenances.map((p) => p.attribution)))
      .slice(0, 4)
      .join(' | ')
      .slice(0, 500),
    fixture_id: fixtureId,
    cache,
    freshness: primary.freshness,
  };
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

  const primaryProvenance: DataProvenance =
    params.primaryProvenance ??
    synthesizeAggregateProvenance(
      params.records.map((r) => r.provenance),
      params.isoTimestamp
    );

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
 * Creates honest unavailable synthesis provenance when no underlying records are available.
 */
export function createDefaultSynthesisProvenance(
  isoTimestamp: string,
  reason = 'No underlying evidence records available'
): DataProvenance {
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
      status: 'unavailable',
      reason,
    },
    vintage: { status: 'unavailable', reason },
    mode: 'unavailable',
    source_mode: 'unavailable',
    license: {
      id: 'internal-decision-support',
      name: 'Internal Decision Support Only',
    },
    attribution: 'DDS-Solutions Multi-Source Economic Intelligence Engine',
    fixture_id: null,
    cache: null,
    freshness: { status: 'unavailable', reason, fresh_for_seconds: 86400 },
  };
}

export function createOsmFootprintSynthesisProvenance(isoTimestamp: string): DataProvenance {
  const reason =
    'OSM commercial footprint summary supplied without element-level evidence provenance';
  return {
    schema_version: 1,
    source: {
      provider_id: 'osm-commercial',
      feed_id: 'overpass-commercial-poi',
      name: 'OpenStreetMap Commercial & Amenity Infrastructure',
      canonical_url: 'https://www.openstreetmap.org/',
    },
    retrieved_at: isoTimestamp,
    observation_period: { status: 'unavailable', reason },
    vintage: { status: 'unavailable', reason },
    mode: 'unavailable',
    source_mode: 'unavailable',
    license: {
      id: 'odbl-1.0',
      name: 'Open Database License (ODbL) 1.0',
    },
    attribution: '© OpenStreetMap contributors (ODbL 1.0)',
    fixture_id: null,
    cache: null,
    freshness: { status: 'unavailable', reason, fresh_for_seconds: 86400 },
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
