import { z } from 'zod';
import { TenantIdSchema } from './identity.js';
import { LayerAccessCredentialStateSchema, LayerAccessTermsStateSchema } from './layerAccess.js';
import { ProviderRegistryIdSchema } from './providerRegistry.js';

const IsoTimeSchema = z.string().datetime({ offset: true });

/**
 * Permitted secret categories. Provider passwords are strictly out of scope
 * per PLAN.md §4.5 and cannot be represented in this schema.
 */
export const SecretKindSchema = z.enum(['api_key', 'token', 'client_secret']);
export type SecretKind = z.infer<typeof SecretKindSchema>;

export const TenantLayerCredentialSubmissionSchema = z
  .object({
    provider_id: ProviderRegistryIdSchema,
    secret_kind: SecretKindSchema,
    secret_value: z.string().min(1).max(4_096),
  })
  .strict();
export type TenantLayerCredentialSubmission = z.infer<typeof TenantLayerCredentialSubmissionSchema>;

export const TenantLayerCredentialRevocationSchema = z
  .object({
    provider_id: ProviderRegistryIdSchema,
    reason: z.string().min(1).max(500),
  })
  .strict();
export type TenantLayerCredentialRevocation = z.infer<typeof TenantLayerCredentialRevocationSchema>;

export const TenantLayerCredentialValidationRequestSchema = z
  .object({
    provider_id: ProviderRegistryIdSchema,
  })
  .strict();
export type TenantLayerCredentialValidationRequest = z.infer<
  typeof TenantLayerCredentialValidationRequestSchema
>;

export const TenantLayerCredentialRecordSchema = z
  .object({
    tenant_id: TenantIdSchema,
    provider_id: ProviderRegistryIdSchema,
    secret_kind: SecretKindSchema,
    masked_fingerprint: z.string().regex(/^\u2022{8}(?: [A-Z0-9]{4})?$/),
    status: LayerAccessCredentialStateSchema,
    validated_at: IsoTimeSchema.nullable(),
    validation_error: z.string().min(1).max(500).nullable(),
    created_at: IsoTimeSchema,
    updated_at: IsoTimeSchema,
    revoked_at: IsoTimeSchema.nullable(),
  })
  .strict();
export type TenantLayerCredentialRecord = z.infer<typeof TenantLayerCredentialRecordSchema>;

export const TenantLayerTermsAcceptanceSchema = z
  .object({
    provider_id: ProviderRegistryIdSchema,
    terms_id: z.string().min(1).max(128),
    reviewed_url: z.string().url().max(2_048),
    version_digest: z.string().min(1).max(128),
    approved_use: z.array(z.string().min(1).max(128)).min(1).max(10),
    approved_environments: z.array(z.string().min(1).max(128)).min(1).max(10),
    expires_at: IsoTimeSchema.nullable().optional(),
  })
  .strict();
export type TenantLayerTermsAcceptance = z.infer<typeof TenantLayerTermsAcceptanceSchema>;

export const TenantLayerTermsRevocationSchema = z
  .object({
    provider_id: ProviderRegistryIdSchema,
    reason: z.string().min(1).max(500),
  })
  .strict();
export type TenantLayerTermsRevocation = z.infer<typeof TenantLayerTermsRevocationSchema>;

export const TenantLayerTermsRecordSchema = z
  .object({
    tenant_id: TenantIdSchema,
    provider_id: ProviderRegistryIdSchema,
    terms_id: z.string().min(1).max(128),
    status: LayerAccessTermsStateSchema,
    reviewed_url: z.string().url().max(2_048),
    version_digest: z.string().min(1).max(128),
    approved_by: z.string().min(1).max(128),
    approved_use: z.array(z.string().min(1).max(128)),
    approved_environments: z.array(z.string().min(1).max(128)),
    reviewed_at: IsoTimeSchema,
    expires_at: IsoTimeSchema.nullable(),
    revoked_at: IsoTimeSchema.nullable(),
  })
  .strict();
export type TenantLayerTermsRecord = z.infer<typeof TenantLayerTermsRecordSchema>;
