import {
  type DataFreshness,
  type DataProvenance,
  DataProvenanceCarrierSchema,
  DataProvenanceSchema,
  type DataProvenanceSourceMode,
  type DataVintage,
  type ObservationPeriod,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { PROVIDER_DEFINITIONS, resolveProviderDefinitionSource } from './registryDefinitions.js';

const DEFAULT_VINTAGE: DataVintage = {
  status: 'unavailable',
  reason: 'This telemetry response does not publish a separate source vintage identifier',
};

export interface CreateDataProvenanceOptions {
  providerId: string;
  feedId: string;
  clock: SimClock;
  sourceMode: DataProvenanceSourceMode;
  observationPeriod: ObservationPeriod;
  vintage?: DataVintage;
  fixtureId?: string;
}

export interface MarkCachedProvenanceOptions {
  clock: SimClock;
  cacheId: string;
  storedAtMs: number;
}

function findFeed(providerId: string, feedId: string, sourceMode: DataProvenanceSourceMode) {
  const provider = PROVIDER_DEFINITIONS.find((candidate) => candidate.id === providerId);
  if (!provider) {
    throw new Error(`Unknown provenance provider '${providerId}'`);
  }
  const feed = provider.feeds.find((candidate) => candidate.id === feedId);
  if (!feed) {
    throw new Error(`Unknown provenance feed '${feedId}' for provider '${providerId}'`);
  }
  if (feed.implementation !== 'implemented' || feed.freshness.status !== 'defined') {
    throw new Error(`Feed '${feedId}' does not have an implemented freshness policy`);
  }
  return {
    provider,
    feed,
    source: resolveProviderDefinitionSource(provider, sourceMode),
    freshForSeconds: feed.freshness.fresh_for_seconds,
  };
}

export function getFeedFreshnessSeconds(feedId: string): number {
  for (const provider of PROVIDER_DEFINITIONS) {
    const feed = provider.feeds.find((candidate) => candidate.id === feedId);
    if (feed) {
      if (feed.implementation !== 'implemented' || feed.freshness.status !== 'defined') {
        throw new Error(`Feed '${feedId}' does not have an implemented freshness policy`);
      }
      return feed.freshness.fresh_for_seconds;
    }
  }
  throw new Error(`Unknown provider feed '${feedId}'`);
}

export function observationPeriodFromUnixSeconds(timestampSeconds: number): ObservationPeriod {
  if (!Number.isInteger(timestampSeconds) || timestampSeconds < 0) {
    throw new Error('Observation timestamp must be nonnegative Unix seconds');
  }
  const instant = new Date(timestampSeconds * 1000).toISOString();
  return { status: 'available', start: instant, end: instant };
}

export function observationPeriodFromUnixRange(
  startSeconds: number,
  endSeconds: number
): ObservationPeriod {
  if (
    !Number.isInteger(startSeconds) ||
    !Number.isInteger(endSeconds) ||
    startSeconds < 0 ||
    endSeconds < startSeconds
  ) {
    throw new Error('Observation range must contain ordered nonnegative Unix seconds');
  }
  return {
    status: 'available',
    start: new Date(startSeconds * 1000).toISOString(),
    end: new Date(endSeconds * 1000).toISOString(),
  };
}

export function observationPeriodFromIso(instant: string): ObservationPeriod {
  const timestamp = Date.parse(instant);
  if (!Number.isFinite(timestamp)) {
    return { status: 'unavailable', reason: 'Source did not provide a valid observation time' };
  }
  const normalized = new Date(timestamp).toISOString();
  return { status: 'available', start: normalized, end: normalized };
}

export function unavailableObservationPeriod(reason: string): ObservationPeriod {
  return { status: 'unavailable', reason };
}

export function classifyFreshness(
  observationPeriod: ObservationPeriod,
  retrievedAtMs: number,
  freshForSeconds: number
): DataFreshness {
  if (observationPeriod.status === 'unavailable') {
    return {
      status: 'unavailable',
      reason: observationPeriod.reason,
      fresh_for_seconds: freshForSeconds,
    };
  }

  const observationEndMs = Date.parse(observationPeriod.end);
  const ageSeconds = Math.max(0, (retrievedAtMs - observationEndMs) / 1000);
  return {
    status: ageSeconds <= freshForSeconds ? 'fresh' : 'stale',
    age_seconds: ageSeconds,
    fresh_for_seconds: freshForSeconds,
  };
}

export function createDataProvenance(options: CreateDataProvenanceOptions): DataProvenance {
  const { provider, feed, source, freshForSeconds } = findFeed(
    options.providerId,
    options.feedId,
    options.sourceMode
  );
  const retrievedAtMs = options.clock.now();

  return DataProvenanceSchema.parse({
    schema_version: 1,
    source: {
      provider_id: provider.id,
      feed_id: feed.id,
      name: source.name,
      canonical_url: source.url,
    },
    retrieved_at: options.clock.iso(),
    observation_period: options.observationPeriod,
    vintage: options.vintage ?? DEFAULT_VINTAGE,
    mode: options.sourceMode,
    source_mode: options.sourceMode,
    license: {
      id: source.license_id,
      name: source.license,
    },
    attribution: source.attribution,
    fixture_id: options.sourceMode === 'seed' ? (options.fixtureId ?? null) : null,
    cache: null,
    freshness: classifyFreshness(options.observationPeriod, retrievedAtMs, freshForSeconds),
  });
}

export function markResponseProvenanceCached(
  body: unknown,
  options: MarkCachedProvenanceOptions
): unknown {
  const parsed = DataProvenanceCarrierSchema.safeParse(body);
  if (!parsed.success) {
    return body;
  }

  const original = parsed.data.provenance;
  const provenance = DataProvenanceSchema.parse({
    ...original,
    retrieved_at: options.clock.iso(),
    mode: 'cached',
    cache: {
      cache_id: options.cacheId,
      stored_at: new Date(options.storedAtMs).toISOString(),
      origin_retrieved_at: original.retrieved_at,
    },
    freshness: classifyFreshness(
      original.observation_period,
      options.clock.now(),
      original.freshness.fresh_for_seconds
    ),
  });

  return { ...parsed.data, provenance };
}
