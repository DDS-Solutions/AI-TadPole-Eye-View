import { describe, expect, it } from 'vitest';
import { DataProvenanceSchema, FlightBatch } from '../src/index.js';

const validSeedProvenance = {
  schema_version: 1,
  source: {
    provider_id: 'example-provider',
    feed_id: 'flights',
    name: 'Example Source',
    canonical_url: 'https://example.com/data',
  },
  retrieved_at: '2026-08-29T12:00:00.000Z',
  observation_period: {
    status: 'available',
    start: '2026-08-29T11:59:55.000Z',
    end: '2026-08-29T11:59:55.000Z',
  },
  vintage: {
    status: 'unavailable',
    reason: 'Source does not publish a separate vintage',
  },
  mode: 'seed',
  source_mode: 'seed',
  license: { id: 'example-terms', name: 'Example terms' },
  attribution: 'Example Source',
  fixture_id: 'flights-example-v1',
  cache: null,
  freshness: { status: 'fresh', age_seconds: 5, fresh_for_seconds: 30 },
} as const;

describe('Data provenance contracts', () => {
  it('validates complete seed and cached provenance envelopes', () => {
    expect(DataProvenanceSchema.parse(validSeedProvenance).mode).toBe('seed');
    expect(
      DataProvenanceSchema.parse({
        ...validSeedProvenance,
        mode: 'cached',
        retrieved_at: '2026-08-29T12:00:10.000Z',
        cache: {
          cache_id: 'cache-example-v1',
          stored_at: '2026-08-29T12:00:00.000Z',
          origin_retrieved_at: '2026-08-29T12:00:00.000Z',
        },
      }).source_mode
    ).toBe('seed');
  });

  it.each(['source', 'retrieved_at', 'observation_period', 'vintage', 'license', 'attribution'])(
    'rejects provenance missing required %s metadata',
    (field) => {
      const candidate: Record<string, unknown> = structuredClone(validSeedProvenance);
      delete candidate[field];
      expect(DataProvenanceSchema.safeParse(candidate).success).toBe(false);
    }
  );

  it('rejects inconsistent fixture, cache, and observation-period semantics', () => {
    expect(
      DataProvenanceSchema.safeParse({ ...validSeedProvenance, fixture_id: null }).success
    ).toBe(false);
    expect(
      DataProvenanceSchema.safeParse({
        ...validSeedProvenance,
        mode: 'cached',
        cache: null,
      }).success
    ).toBe(false);
    expect(
      DataProvenanceSchema.safeParse({
        ...validSeedProvenance,
        observation_period: {
          status: 'available',
          start: '2026-08-29T12:00:00.000Z',
          end: '2026-08-29T11:59:00.000Z',
        },
      }).success
    ).toBe(false);
  });

  it('requires provenance on complete telemetry batches', () => {
    expect(FlightBatch.safeParse({ time: 1_700_000_000, states: [] }).success).toBe(false);
    expect(
      FlightBatch.safeParse({
        time: 1_700_000_000,
        states: [],
        provenance: validSeedProvenance,
      }).success
    ).toBe(true);
  });
});
