import { z } from 'zod';
import {
  ProviderImplementationStateSchema,
  ProviderRegistryCountsSchema,
  ProviderRegistryFeedSchema,
  ProviderRegistryIdSchema,
  ProviderRegistryLayerSchema,
  ProviderRequestedModeSchema,
  ProviderRuntimeModeSchema,
  ProviderSourceAccessSchema,
  ProviderSourceSchema,
} from './providerRegistry.js';

const IsoTimeSchema = z.string().datetime({ offset: true });

export const LayerAccessCredentialStateSchema = z.enum([
  'not_required',
  'missing',
  'pending_validation',
  'valid',
  'invalid',
  'expired',
  'revoked',
  'scope_insufficient',
]);
export type LayerAccessCredentialState = z.infer<typeof LayerAccessCredentialStateSchema>;

export const LayerAccessTermsStateSchema = z.enum([
  'not_required',
  'unreviewed',
  'pending_approval',
  'approved',
  'rejected',
  'expired',
  'superseded',
]);
export type LayerAccessTermsState = z.infer<typeof LayerAccessTermsStateSchema>;

export const LayerAccessConfigurationStateSchema = z.enum([
  'not_required',
  'missing',
  'valid',
  'invalid',
]);
export type LayerAccessConfigurationState = z.infer<typeof LayerAccessConfigurationStateSchema>;

export const LayerAccessRuntimeStateSchema = z.enum([
  'healthy',
  'degraded',
  'stale',
  'unavailable',
]);
export type LayerAccessRuntimeState = z.infer<typeof LayerAccessRuntimeStateSchema>;

export const LayerEffectiveAccessStateSchema = z.enum([
  'available',
  'setup_required',
  'approval_required',
  'configuration_required',
  'planned',
  'disabled',
  'stasis',
  'unavailable',
]);
export type LayerEffectiveAccessState = z.infer<typeof LayerEffectiveAccessStateSchema>;

export const LayerAccessLocalStatusSchema = z
  .object({
    visibility: z.enum(['available', 'unavailable']),
    reason: z.string().min(1).max(500).nullable(),
  })
  .superRefine((status, context) => {
    if (status.visibility === 'unavailable' && status.reason === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'unavailable local status requires a reason',
      });
    }
    if (status.visibility === 'available' && status.reason !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'available local status cannot carry an unavailable reason',
      });
    }
  });

export const LayerAccessCredentialRuntimeSchema = z.object({
  status: LayerAccessCredentialStateSchema,
  masked_fingerprint: z
    .string()
    .regex(/^\u2022{8}(?: [A-Z0-9]{4})?$/)
    .nullable(),
  validated_at: IsoTimeSchema.nullable(),
});
export type LayerAccessCredentialRuntime = z.infer<typeof LayerAccessCredentialRuntimeSchema>;

export const LayerAccessProviderRuntimeInputSchema = z.object({
  provider_id: ProviderRegistryIdSchema,
  credential: LayerAccessCredentialRuntimeSchema.optional(),
  terms: z
    .object({
      status: LayerAccessTermsStateSchema,
      reviewed_at: IsoTimeSchema.nullable(),
      expires_at: IsoTimeSchema.nullable(),
    })
    .optional(),
  configuration: z
    .object({
      status: LayerAccessConfigurationStateSchema,
      checked_at: IsoTimeSchema.nullable(),
    })
    .optional(),
  policy: z
    .object({
      enabled: z.boolean(),
      reason: z.string().min(1).max(500).nullable(),
    })
    .optional(),
  runtime: z
    .object({
      status: LayerAccessRuntimeStateSchema,
      observation_at: IsoTimeSchema.nullable(),
      retrieved_at: IsoTimeSchema.nullable(),
      cache_origin_at: IsoTimeSchema.nullable(),
      last_success_at: IsoTimeSchema.nullable(),
      last_error_at: IsoTimeSchema.nullable(),
      next_poll_at: IsoTimeSchema.nullable(),
      detail: z.string().min(1).max(500).nullable(),
    })
    .optional(),
});
export type LayerAccessProviderRuntimeInput = z.infer<typeof LayerAccessProviderRuntimeInputSchema>;

export const LayerAccessRuntimeSnapshotSchema = z.object({
  version: z.literal(1),
  observed_at: IsoTimeSchema,
  stasis_active: z.boolean(),
  budget_remaining_usd: z.number().finite().nonnegative(),
  authority: z.object({
    kind: z.enum(['authenticated_local_operator', 'local_seed', 'unavailable']),
    credential_status_access: z.enum(['masked_status', 'unavailable']),
    reason: z.string().min(1).max(500).nullable(),
  }),
  providers: z.array(LayerAccessProviderRuntimeInputSchema).max(2_500),
});
export type LayerAccessRuntimeSnapshot = z.infer<typeof LayerAccessRuntimeSnapshotSchema>;

const ProjectedCredentialSchema = ProviderSourceAccessSchema.shape.credential.extend({
  local_status: LayerAccessLocalStatusSchema,
  status: LayerAccessCredentialStateSchema.nullable(),
  masked_fingerprint: z
    .string()
    .regex(/^\u2022{8}(?: [A-Z0-9]{4})?$/)
    .nullable(),
  validated_at: IsoTimeSchema.nullable(),
});

const ProjectedTermsSchema = ProviderSourceAccessSchema.shape.approval.extend({
  local_status: LayerAccessLocalStatusSchema,
  status: LayerAccessTermsStateSchema.nullable(),
  reviewed_at: IsoTimeSchema.nullable(),
  expires_at: IsoTimeSchema.nullable(),
});

const ProjectedConfigurationSchema = ProviderSourceAccessSchema.shape.configuration.extend({
  local_status: LayerAccessLocalStatusSchema,
  current_state: LayerAccessConfigurationStateSchema.nullable(),
  checked_at: IsoTimeSchema.nullable(),
});

export const LayerAccessLockReasonSchema = z.object({
  gate: z.enum(['implementation', 'credential', 'terms', 'configuration', 'policy', 'runtime']),
  code: ProviderRegistryIdSchema,
  message: z.string().min(1).max(500),
});

export const LayerAccessEntrySchema = z.object({
  id: ProviderRegistryIdSchema,
  domain: ProviderRegistryIdSchema,
  provider_name: z.string().min(1),
  source: ProviderSourceSchema,
  implementation: ProviderImplementationStateSchema,
  feeds: z.array(ProviderRegistryFeedSchema).min(1),
  layers: z.array(ProviderRegistryLayerSchema).min(1),
  products: ProviderSourceAccessSchema.shape.products,
  credential: ProjectedCredentialSchema,
  terms: ProjectedTermsSchema,
  configuration: ProjectedConfigurationSchema,
  policy: ProviderSourceAccessSchema.shape.operations.extend({
    enabled: z.boolean(),
    reason: z.string().min(1).max(500).nullable(),
    budget_remaining_usd: z.number().finite().nonnegative(),
    stasis_active: z.boolean(),
  }),
  runtime: z.object({
    mode: ProviderRuntimeModeSchema,
    status: LayerAccessRuntimeStateSchema,
    observation_at: IsoTimeSchema.nullable(),
    retrieved_at: IsoTimeSchema.nullable(),
    cache_origin_at: IsoTimeSchema.nullable(),
    last_success_at: IsoTimeSchema.nullable(),
    last_error_at: IsoTimeSchema.nullable(),
    next_poll_at: IsoTimeSchema.nullable(),
    detail: z.string().min(1).max(500).nullable(),
  }),
  effective_access: LayerEffectiveAccessStateSchema,
  lock_reasons: z.array(LayerAccessLockReasonSchema).max(8),
  setup_instructions: ProviderSourceAccessSchema.shape.setup_instructions,
  documentation_paths: z.array(z.string().min(1).max(300)).min(1).max(12),
});
export type LayerAccessEntry = z.infer<typeof LayerAccessEntrySchema>;

const EffectiveCountsSchema = z.object({
  available: z.number().int().nonnegative(),
  setup_required: z.number().int().nonnegative(),
  approval_required: z.number().int().nonnegative(),
  configuration_required: z.number().int().nonnegative(),
  planned: z.number().int().nonnegative(),
  disabled: z.number().int().nonnegative(),
  stasis: z.number().int().nonnegative(),
  unavailable: z.number().int().nonnegative(),
});

export const LayerAccessReadModelSchema = z.object({
  version: z.literal(1),
  generated_at: IsoTimeSchema,
  requested_mode: ProviderRequestedModeSchema,
  authority: LayerAccessRuntimeSnapshotSchema.shape.authority,
  counts: z.object({
    registry: ProviderRegistryCountsSchema,
    effective: EffectiveCountsSchema,
  }),
  entries: z.array(LayerAccessEntrySchema).min(1).max(2_500),
});
export type LayerAccessReadModel = z.infer<typeof LayerAccessReadModelSchema>;

export function filterLayerAccessEntries(
  entries: readonly LayerAccessEntry[],
  query: string,
  effectiveAccess: LayerEffectiveAccessState | 'all' = 'all'
): LayerAccessEntry[] {
  const normalized = query.trim().toLocaleLowerCase('en-US');
  return entries.filter((entry) => {
    if (effectiveAccess !== 'all' && entry.effective_access !== effectiveAccess) return false;
    if (!normalized) return true;
    const haystack = [
      entry.provider_name,
      entry.source.name,
      entry.domain,
      ...entry.feeds.flatMap((feed) => [feed.id, feed.name]),
      ...entry.layers.flatMap((layer) => [layer.id, layer.name]),
      ...entry.products.flatMap((product) => [product.id, product.name, product.coverage]),
    ]
      .join('\n')
      .toLocaleLowerCase('en-US');
    return haystack.includes(normalized);
  });
}
