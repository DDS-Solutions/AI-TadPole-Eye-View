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
      source_access: {
        domain: 'example',
        evidence_reviewed_on: '2026-09-05',
        decision_rank: null,
        products: [
          {
            id: 'example-product',
            name: 'Example Product',
            transport: 'https',
            endpoints: ['https://example.com/data'],
            formats: ['JSON'],
            coverage: 'Example coverage',
            time_semantics: 'Observation and retrieval time remain distinct',
          },
        ],
        credential: {
          kind: 'none',
          setup_url: 'https://example.com/setup',
          required_scopes: [],
          validation_method: 'No credential required',
        },
        approval: {
          owner: 'example-owner',
          status: 'not_required',
          terms_url: 'https://example.com/terms',
          attribution_url: 'https://example.com/attribution',
          allowed_live_environments: ['development'],
        },
        configuration: {
          status: 'not_required',
          description: 'No configuration required',
        },
        operations: {
          refresh_seconds: 60,
          fresh_cache_seconds: 60,
          max_stale_seconds: 300,
          upstream_rate_limit: 'One request per minute',
          budget_policy: 'No source fee',
          timeout_ms: 10_000,
          max_response_bytes: 1_048_576,
          max_records: 100,
          max_concurrency: 1,
          kill_switch: 'EXAMPLE_ENABLED',
          kill_switch_owner: 'example-owner',
          fallback: 'Report unavailable',
        },
        setup_instructions: ['Review the example source requirements.'],
      },
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
