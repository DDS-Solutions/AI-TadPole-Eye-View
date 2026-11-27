import { z } from 'zod';
import { BusinessContextInputSchema } from './economic.js';
import { TenantIdSchema } from './identity.js';

export const BUSINESS_CONTEXT_PERSISTENCE_SCHEMA_VERSION = 1 as const;
export const BUSINESS_CONTEXT_EXPORT_FORMAT_VERSION = 'gev.business_context.export.v1' as const;
export const BUSINESS_CONTEXT_BACKUP_FORMAT_VERSION = 'gev.business_context.backup.v1' as const;
export const BUSINESS_CONTEXT_DELETION_RECEIPT_VERSION =
  'gev.business_context.deletion.v1' as const;

export const BUSINESS_CONTEXT_LIMITS = {
  maxPayloadBytes: 65_536,
  maxDepth: 16,
  minRetentionDays: 1,
  defaultRetentionDays: 365,
  maxRetentionDays: 3_650,
  maxChangeReasonChars: 500,
} as const;

export const BusinessContextIdSchema = z
  .string()
  .min(3)
  .max(96)
  .regex(
    /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/,
    'BusinessContext identifier must be lowercase alphanumeric with hyphens, underscores, or dots'
  );
export type BusinessContextId = z.infer<typeof BusinessContextIdSchema>;

const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Expected 64-character lowercase SHA-256 hex digest');

const IsoTimestampSchema = z.string().datetime({ offset: true });

export const BusinessContextCreateRequestSchema = z
  .object({
    context_id: BusinessContextIdSchema.optional(),
    input: BusinessContextInputSchema,
    retention_days: z
      .number()
      .int()
      .min(BUSINESS_CONTEXT_LIMITS.minRetentionDays)
      .max(BUSINESS_CONTEXT_LIMITS.maxRetentionDays)
      .optional(),
    legal_hold: z.boolean().optional(),
    change_reason: z.string().min(1).max(BUSINESS_CONTEXT_LIMITS.maxChangeReasonChars).optional(),
  })
  .strict();
export type BusinessContextCreateRequest = z.infer<typeof BusinessContextCreateRequestSchema>;

export const BusinessContextUpdateRequestSchema = z
  .object({
    expected_version: z.number().int().min(1),
    input: BusinessContextInputSchema,
    retention_days: z
      .number()
      .int()
      .min(BUSINESS_CONTEXT_LIMITS.minRetentionDays)
      .max(BUSINESS_CONTEXT_LIMITS.maxRetentionDays)
      .optional(),
    legal_hold: z.boolean().optional(),
    change_reason: z.string().min(1).max(BUSINESS_CONTEXT_LIMITS.maxChangeReasonChars).optional(),
  })
  .strict();
export type BusinessContextUpdateRequest = z.infer<typeof BusinessContextUpdateRequestSchema>;

export const BusinessContextMetadataSchema = z
  .object({
    schema_version: z.literal(BUSINESS_CONTEXT_PERSISTENCE_SCHEMA_VERSION),
    context_id: BusinessContextIdSchema,
    tenant_id: TenantIdSchema,
    version: z.number().int().min(1),
    payload_sha256: Sha256HexSchema,
    encryption_algorithm: z.literal('aes-256-gcm'),
    encryption_key_id: z.string().min(1).max(64),
    retention_days: z
      .number()
      .int()
      .min(BUSINESS_CONTEXT_LIMITS.minRetentionDays)
      .max(BUSINESS_CONTEXT_LIMITS.maxRetentionDays),
    expires_at: IsoTimestampSchema,
    legal_hold: z.boolean(),
    created_at: IsoTimestampSchema,
    updated_at: IsoTimestampSchema,
    created_by: z.string().min(1).max(128),
    updated_by: z.string().min(1).max(128),
    change_reason: z.string().min(1).max(BUSINESS_CONTEXT_LIMITS.maxChangeReasonChars).optional(),
  })
  .strict();
export type BusinessContextMetadata = z.infer<typeof BusinessContextMetadataSchema>;

export const PersistedBusinessContextSchema = BusinessContextMetadataSchema.extend({
  input: BusinessContextInputSchema,
}).strict();
export type PersistedBusinessContext = z.infer<typeof PersistedBusinessContextSchema>;

export const BusinessContextVersionSummarySchema = z
  .object({
    version: z.number().int().min(1),
    payload_sha256: Sha256HexSchema,
    encryption_key_id: z.string().min(1).max(64),
    created_at: IsoTimestampSchema,
    created_by: z.string().min(1).max(128),
    change_reason: z.string().min(1).max(BUSINESS_CONTEXT_LIMITS.maxChangeReasonChars).optional(),
  })
  .strict();
export type BusinessContextVersionSummary = z.infer<typeof BusinessContextVersionSummarySchema>;

export const BusinessContextExportBundleSchema = z
  .object({
    format_version: z.literal(BUSINESS_CONTEXT_EXPORT_FORMAT_VERSION),
    exported_at: IsoTimestampSchema,
    tenant_id: TenantIdSchema,
    exported_by: z.string().min(1).max(128),
    context: PersistedBusinessContextSchema,
    version_history: z.array(BusinessContextVersionSummarySchema).min(1).max(500),
    bundle_sha256: Sha256HexSchema,
  })
  .strict();
export type BusinessContextExportBundle = z.infer<typeof BusinessContextExportBundleSchema>;

export const BusinessContextEncryptedVersionBackupSchema = z
  .object({
    version: z.number().int().min(1),
    encrypted_payload: z.string().min(32).max(262_144),
    payload_sha256: Sha256HexSchema,
    encryption_key_id: z.string().min(1).max(64),
    created_at: IsoTimestampSchema,
    created_by: z.string().min(1).max(128),
    change_reason: z.string().min(1).max(BUSINESS_CONTEXT_LIMITS.maxChangeReasonChars).optional(),
  })
  .strict();
export type BusinessContextEncryptedVersionBackup = z.infer<
  typeof BusinessContextEncryptedVersionBackupSchema
>;

export const BusinessContextEncryptedBackupSchema = z
  .object({
    format_version: z.literal(BUSINESS_CONTEXT_BACKUP_FORMAT_VERSION),
    backed_up_at: IsoTimestampSchema,
    tenant_id: TenantIdSchema,
    context_id: BusinessContextIdSchema,
    current_version: z.number().int().min(1),
    encryption_algorithm: z.literal('aes-256-gcm'),
    encryption_key_id: z.string().min(1).max(64),
    retention_days: z
      .number()
      .int()
      .min(BUSINESS_CONTEXT_LIMITS.minRetentionDays)
      .max(BUSINESS_CONTEXT_LIMITS.maxRetentionDays),
    expires_at: IsoTimestampSchema,
    legal_hold: z.boolean(),
    created_at: IsoTimestampSchema,
    updated_at: IsoTimestampSchema,
    created_by: z.string().min(1).max(128),
    updated_by: z.string().min(1).max(128),
    encrypted_versions: z.array(BusinessContextEncryptedVersionBackupSchema).min(1).max(500),
    backup_sha256: Sha256HexSchema,
  })
  .strict();
export type BusinessContextEncryptedBackup = z.infer<typeof BusinessContextEncryptedBackupSchema>;

export const BusinessContextDeletionReceiptSchema = z
  .object({
    format_version: z.literal(BUSINESS_CONTEXT_DELETION_RECEIPT_VERSION),
    receipt_id: z.string().uuid(),
    tenant_id: TenantIdSchema,
    context_id: BusinessContextIdSchema,
    deleted_at: IsoTimestampSchema,
    deleted_by: z.string().min(1).max(128),
    versions_purged: z.number().int().min(1),
    verified_zero_remaining: z.literal(true),
    audit_intent_id: z.string().min(1).max(128),
  })
  .strict();
export type BusinessContextDeletionReceipt = z.infer<typeof BusinessContextDeletionReceiptSchema>;

export const BusinessContextRetentionPurgeResultSchema = z
  .object({
    purged_at: IsoTimestampSchema,
    purged_count: z.number().int().min(0),
    receipts: z.array(BusinessContextDeletionReceiptSchema),
  })
  .strict();
export type BusinessContextRetentionPurgeResult = z.infer<
  typeof BusinessContextRetentionPurgeResultSchema
>;

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively rejects prototype-pollution keys and excessive object nesting depth
 * before domain persistence or deserialization (Scene Document v7 defense pattern).
 */
export function assertSafeStructuredValue(
  value: unknown,
  maxDepth: number = BUSINESS_CONTEXT_LIMITS.maxDepth,
  depth = 0
): void {
  if (depth > maxDepth) {
    throw new Error(`Payload nesting depth exceeded maximum allowed depth (${maxDepth})`);
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertSafeStructuredValue(item, maxDepth, depth + 1);
    }
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new Error(`Forbidden prototype key '${key}' rejected in BusinessContext payload`);
    }
    assertSafeStructuredValue((value as Record<string, unknown>)[key], maxDepth, depth + 1);
  }
}

/**
 * Parses a raw JSON payload with strict pre-parse UTF-8 byte limits, depth bounds,
 * and prototype-key rejection before Zod boundary validation.
 */
export function parseBoundedJsonPayload(
  rawJson: string,
  maxBytes: number = BUSINESS_CONTEXT_LIMITS.maxPayloadBytes
): unknown {
  const byteLength = new TextEncoder().encode(rawJson).byteLength;
  if (byteLength > maxBytes) {
    throw new Error(`Payload size ${byteLength} bytes exceeds maximum bound (${maxBytes} bytes)`);
  }
  const parsed: unknown = JSON.parse(rawJson, (key, value) => {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new Error(`Forbidden prototype key '${key}' rejected in JSON payload`);
    }
    return value;
  });
  assertSafeStructuredValue(parsed);
  return parsed;
}
