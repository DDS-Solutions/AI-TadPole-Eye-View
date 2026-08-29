import { describe, expect, it } from 'vitest';
import { ProviderRegistrySchema, SystemHealthResponseSchema } from '../src/index.js';

const validRegistry = {
  version: 2,
  requested_mode: 'seed',
  providers: [
    {
      id: 'example-provider',
      name: 'Example Provider',
      source: {
        name: 'Example Source',
        url: 'https://example.com/',
        license_id: 'example-terms',
        license: 'Example terms',
        attribution: 'Example Source',
      },
      implementation: 'implemented',
      supported_modes: ['seed'],
      mode: 'seed',
      health: 'healthy',
      feeds: [
        {
          id: 'example-feed',
          name: 'Example Feed',
          implementation: 'implemented',
          freshness: { status: 'defined', fresh_for_seconds: 60 },
        },
      ],
      layers: [
        {
          id: 'example-layer',
          name: 'Example Layer',
          implementation: 'implemented',
          documentation_path: 'docs/data-sources/example-layer.md',
        },
      ],
    },
  ],
} as const;

describe('Provider registry contracts', () => {
  it('validates a typed provider/feed/layer registry boundary', () => {
    const parsed = ProviderRegistrySchema.parse(validRegistry);
    expect(parsed.providers[0]?.feeds[0]?.id).toBe('example-feed');
  });

  it('rejects duplicate feed and layer identities', () => {
    const duplicate = {
      ...validRegistry,
      providers: [
        validRegistry.providers[0],
        {
          ...validRegistry.providers[0],
          id: 'second-provider',
        },
      ],
    };

    const result = ProviderRegistrySchema.safeParse(duplicate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('duplicate feed ID');
      expect(result.error.message).toContain('duplicate layer ID');
    }
  });

  it('rejects healthy state for incomplete or unavailable providers', () => {
    expect(() =>
      ProviderRegistrySchema.parse({
        ...validRegistry,
        providers: [
          {
            ...validRegistry.providers[0],
            implementation: 'incomplete',
          },
        ],
      })
    ).toThrow(/cannot be healthy/);

    expect(() =>
      ProviderRegistrySchema.parse({
        ...validRegistry,
        providers: [
          {
            ...validRegistry.providers[0],
            mode: 'unavailable',
          },
        ],
      })
    ).toThrow(/must report unavailable health/);
  });

  it('validates registry state carried by system health responses', () => {
    const health = SystemHealthResponseSchema.parse({
      status: 'ok',
      version: '1.1.0',
      seed_mode: true,
      timestamp: 1_700_000_000_000,
      stasis_active: false,
      budget_spent_usd: 0,
      budget_cap_usd: 10,
      budget_remaining_usd: 10,
      governance_authority: {
        kind: 'shared_sqlite',
        authoritative: true,
        schema_version: 1,
        state_revision: 0,
      },
      provider_registry: validRegistry,
    });
    expect(health.provider_registry.requested_mode).toBe('seed');
  });
});
