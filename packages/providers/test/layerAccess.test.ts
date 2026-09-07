import { LayerAccessReadModelSchema, type LayerAccessRuntimeSnapshot } from '@gev/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayerAccessReadModel } from '../src/layerAccessProjection.js';
import { createProviderRegistry } from '../src/registry.js';

const OBSERVED_AT = '2026-09-06T20:00:00.000Z';

afterEach(() => vi.restoreAllMocks());

function snapshot(overrides: Partial<LayerAccessRuntimeSnapshot> = {}): LayerAccessRuntimeSnapshot {
  return {
    version: 1,
    observed_at: OBSERVED_AT,
    stasis_active: false,
    budget_remaining_usd: 10,
    authority: {
      kind: 'local_seed',
      credential_status_access: 'unavailable',
      reason: 'Authenticated local credential status is unavailable',
    },
    providers: [],
    ...overrides,
  };
}

describe('registry-derived Layer Access projection', () => {
  it('projects every registered provider/feed/layer deterministically without network or wall clock', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const nowSpy = vi.spyOn(Date, 'now');
    const registry = createProviderRegistry({ requestedMode: 'seed' });

    const first = createLayerAccessReadModel(registry, snapshot());
    const second = createLayerAccessReadModel(registry, snapshot());

    expect(second).toEqual(first);
    expect(LayerAccessReadModelSchema.parse(first)).toEqual(first);
    expect(first.entries).toHaveLength(registry.providers.length);
    expect(first.entries.flatMap((entry) => entry.feeds)).toHaveLength(
      registry.providers.flatMap((provider) => provider.feeds).length
    );
    expect(first.entries.flatMap((entry) => entry.layers)).toHaveLength(
      registry.providers.flatMap((provider) => provider.layers).length
    );
    expect(first.counts.effective).toMatchObject({ available: 16, planned: 3 });
    expect(first.entries.map((entry) => `${entry.domain}:${entry.provider_name}`)).toEqual(
      [...first.entries]
        .sort(
          (left, right) =>
            left.domain.localeCompare(right.domain, 'en-US') ||
            left.provider_name.localeCompare(right.provider_name, 'en-US')
        )
        .map((entry) => `${entry.domain}:${entry.provider_name}`)
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it('keeps independent live gates, masked status, policy, STASIS, and stale runtime distinct', () => {
    const registry = createProviderRegistry({ requestedMode: 'live' });
    const model = createLayerAccessReadModel(
      registry,
      snapshot({
        authority: {
          kind: 'authenticated_local_operator',
          credential_status_access: 'masked_status',
          reason: null,
        },
        providers: [
          {
            provider_id: 'opensky',
            credential: {
              status: 'valid',
              masked_fingerprint: '•••••••• A91C',
              validated_at: OBSERVED_AT,
            },
            terms: { status: 'pending_approval', reviewed_at: null, expires_at: null },
            configuration: { status: 'valid', checked_at: OBSERVED_AT },
            runtime: {
              status: 'stale',
              observation_at: '2026-09-06T19:59:00.000Z',
              retrieved_at: OBSERVED_AT,
              cache_origin_at: OBSERVED_AT,
              last_success_at: OBSERVED_AT,
              last_error_at: null,
              next_poll_at: '2026-09-06T20:00:05.000Z',
              detail: 'Source observation is older than its freshness policy',
            },
          },
          {
            provider_id: 'aisstream',
            credential: { status: 'missing', masked_fingerprint: null, validated_at: null },
            terms: { status: 'approved', reviewed_at: OBSERVED_AT, expires_at: null },
            configuration: { status: 'valid', checked_at: OBSERVED_AT },
          },
          {
            provider_id: 'usgs',
            policy: { enabled: false, reason: 'Disabled for the exercise' },
          },
        ],
      })
    );

    const opensky = model.entries.find((entry) => entry.id === 'opensky');
    const ais = model.entries.find((entry) => entry.id === 'aisstream');
    const usgs = model.entries.find((entry) => entry.id === 'usgs');
    expect(opensky).toMatchObject({
      effective_access: 'approval_required',
      credential: { status: 'valid', masked_fingerprint: '•••••••• A91C' },
      terms: { status: 'pending_approval' },
      runtime: { status: 'stale' },
    });
    expect(ais).toMatchObject({ effective_access: 'setup_required' });
    expect(usgs).toMatchObject({ effective_access: 'disabled' });

    const stasis = createLayerAccessReadModel(registry, snapshot({ stasis_active: true }));
    expect(stasis.entries.find((entry) => entry.id === 'opensky')?.effective_access).toBe('stasis');
    expect(stasis.entries.find((entry) => entry.id === 'opensky')?.lock_reasons).toContainEqual(
      expect.objectContaining({ code: 'stasis-active' })
    );
  });
});
