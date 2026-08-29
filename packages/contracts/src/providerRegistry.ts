import { z } from 'zod';
import { GovernanceAuthoritySchema } from './governance.js';

export const ProviderRegistryIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'registry IDs must be lowercase literals');

export const ProviderImplementationStateSchema = z.enum(['implemented', 'incomplete', 'planned']);
export type ProviderImplementationState = z.infer<typeof ProviderImplementationStateSchema>;

export const ProviderRuntimeModeSchema = z.enum(['seed', 'live', 'download_pack', 'unavailable']);
export type ProviderRuntimeMode = z.infer<typeof ProviderRuntimeModeSchema>;

export const ProviderRequestedModeSchema = z.enum(['seed', 'live']);
export type ProviderRequestedMode = z.infer<typeof ProviderRequestedModeSchema>;

export const ProviderHealthSchema = z.enum(['healthy', 'degraded', 'unavailable']);
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const ProviderSourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  license_id: ProviderRegistryIdSchema,
  license: z.string().min(1),
  attribution: z.string().min(1),
});
export type ProviderSource = z.infer<typeof ProviderSourceSchema>;

export const ProviderFreshnessPolicySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('defined'),
    fresh_for_seconds: z.number().int().positive().max(86_400),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.string().min(1).max(500),
  }),
]);
export type ProviderFreshnessPolicy = z.infer<typeof ProviderFreshnessPolicySchema>;

export const ProviderRegistryFeedSchema = z.object({
  id: ProviderRegistryIdSchema,
  name: z.string().min(1),
  implementation: ProviderImplementationStateSchema,
  freshness: ProviderFreshnessPolicySchema,
});
export type ProviderRegistryFeed = z.infer<typeof ProviderRegistryFeedSchema>;

export const ProviderRegistryLayerSchema = z.object({
  id: ProviderRegistryIdSchema,
  name: z.string().min(1),
  implementation: ProviderImplementationStateSchema,
  documentation_path: z.string().regex(/^docs\/data-sources\/[a-z0-9-]+\.md$/),
});
export type ProviderRegistryLayer = z.infer<typeof ProviderRegistryLayerSchema>;

export const ProviderRegistryProviderSchema = z
  .object({
    id: ProviderRegistryIdSchema,
    name: z.string().min(1),
    source: ProviderSourceSchema,
    implementation: ProviderImplementationStateSchema,
    supported_modes: z.array(z.enum(['seed', 'live', 'download_pack'])),
    mode: ProviderRuntimeModeSchema,
    health: ProviderHealthSchema,
    feeds: z.array(ProviderRegistryFeedSchema).min(1),
    layers: z.array(ProviderRegistryLayerSchema).min(1),
  })
  .superRefine((provider, ctx) => {
    if (provider.implementation !== 'implemented' && provider.health === 'healthy') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['health'],
        message: 'incomplete and planned providers cannot be healthy',
      });
    }

    if (provider.mode === 'unavailable' && provider.health !== 'unavailable') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['health'],
        message: 'unavailable providers must report unavailable health',
      });
    }

    if (provider.mode !== 'unavailable' && !provider.supported_modes.includes(provider.mode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mode'],
        message: 'provider mode must be declared in supported_modes',
      });
    }

    if (provider.implementation !== 'implemented') {
      for (const [feedIndex, feed] of provider.feeds.entries()) {
        if (feed.implementation === 'implemented') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['feeds', feedIndex, 'implementation'],
            message: 'a non-implemented provider cannot expose an implemented feed',
          });
        }
      }
      for (const [layerIndex, layer] of provider.layers.entries()) {
        if (layer.implementation === 'implemented') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['layers', layerIndex, 'implementation'],
            message: 'a non-implemented provider cannot expose an implemented layer',
          });
        }
      }
    }

    for (const [feedIndex, feed] of provider.feeds.entries()) {
      if (feed.implementation === 'implemented' && feed.freshness.status !== 'defined') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['feeds', feedIndex, 'freshness'],
          message: 'implemented feeds require a defined freshness policy',
        });
      }
      if (feed.implementation !== 'implemented' && feed.freshness.status !== 'unavailable') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['feeds', feedIndex, 'freshness'],
          message: 'non-implemented feeds cannot claim a freshness policy',
        });
      }
    }
  });
export type ProviderRegistryProvider = z.infer<typeof ProviderRegistryProviderSchema>;

export const ProviderRegistrySchema = z
  .object({
    version: z.literal(2),
    requested_mode: ProviderRequestedModeSchema,
    providers: z.array(ProviderRegistryProviderSchema).min(1),
  })
  .superRefine((registry, ctx) => {
    const providerIds = new Set<string>();
    const feedIds = new Set<string>();
    const layerIds = new Set<string>();

    for (const [providerIndex, provider] of registry.providers.entries()) {
      if (providerIds.has(provider.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', providerIndex, 'id'],
          message: `duplicate provider ID: ${provider.id}`,
        });
      }
      providerIds.add(provider.id);

      for (const [feedIndex, feed] of provider.feeds.entries()) {
        if (feedIds.has(feed.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['providers', providerIndex, 'feeds', feedIndex, 'id'],
            message: `duplicate feed ID: ${feed.id}`,
          });
        }
        feedIds.add(feed.id);
      }

      for (const [layerIndex, layer] of provider.layers.entries()) {
        if (layerIds.has(layer.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['providers', providerIndex, 'layers', layerIndex, 'id'],
            message: `duplicate layer ID: ${layer.id}`,
          });
        }
        layerIds.add(layer.id);
      }
    }
  });
export type ProviderRegistry = z.infer<typeof ProviderRegistrySchema>;

export const ProviderRegistryEntityCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
});

export const ProviderRegistryCountsSchema = z.object({
  providers: ProviderRegistryEntityCountsSchema,
  feeds: ProviderRegistryEntityCountsSchema,
  layers: ProviderRegistryEntityCountsSchema,
});
export type ProviderRegistryCounts = z.infer<typeof ProviderRegistryCountsSchema>;

export const ProviderRegistryFeedViewSchema = z.object({
  id: ProviderRegistryIdSchema,
  name: z.string().min(1),
  provider: ProviderRegistryIdSchema,
  provider_name: z.string().min(1),
  source: ProviderSourceSchema,
  implementation: ProviderImplementationStateSchema,
  freshness: ProviderFreshnessPolicySchema,
  mode: ProviderRuntimeModeSchema,
  status: ProviderHealthSchema,
  layer_ids: z.array(ProviderRegistryIdSchema),
});
export type ProviderRegistryFeedView = z.infer<typeof ProviderRegistryFeedViewSchema>;

export const ProviderFeedHealthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unavailable', 'stasis']),
  timestamp: z.number().finite(),
  stasis_active: z.boolean(),
  budget_remaining_usd: z.number().finite().nonnegative(),
  trace_id: z.string().min(1),
  registry_version: z.literal(2),
  requested_mode: ProviderRequestedModeSchema,
  counts: ProviderRegistryCountsSchema,
  feeds: z.array(ProviderRegistryFeedViewSchema),
});
export type ProviderFeedHealthResponse = z.infer<typeof ProviderFeedHealthResponseSchema>;

export const SystemHealthResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    version: z.string().min(1),
    seed_mode: z.boolean(),
    timestamp: z.number().finite(),
    stasis_active: z.boolean(),
    budget_spent_usd: z.number().finite().nonnegative(),
    budget_cap_usd: z.number().finite().nonnegative(),
    budget_remaining_usd: z.number().finite().nonnegative(),
    governance_authority: GovernanceAuthoritySchema,
    provider_registry: ProviderRegistrySchema,
  })
  .passthrough();
export type SystemHealthResponse = z.infer<typeof SystemHealthResponseSchema>;
