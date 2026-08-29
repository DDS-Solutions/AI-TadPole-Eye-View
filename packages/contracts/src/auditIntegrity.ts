import { z } from 'zod';

export const AUDIT_CHAIN_VERSION = 'gev.audit.chain.v1' as const;
export const AUDIT_EVENT_FORMAT_VERSION = 'gev.audit.event.v1' as const;
export const AUDIT_LINK_FORMAT_VERSION = 'gev.audit.link.v1' as const;
export const AUDIT_REDACTION_VERSION = 'gev.audit.redaction.v1' as const;
export const AUDIT_LEGACY_REDACTION_VERSION = 'legacy-preserved-v0' as const;
export const AUDIT_RETENTION_FORMAT_VERSION = 'gev.audit.retention.v1' as const;

export const AuditIntegrityFailureCodeSchema = z.enum([
  'CHAIN_SCHEMA_MISSING',
  'UNSUPPORTED_VERSION',
  'STATE_MISSING',
  'MALFORMED_ROW',
  'SEQUENCE_GAP',
  'PREVIOUS_HASH_MISMATCH',
  'PAYLOAD_HASH_MISMATCH',
  'CHAIN_HASH_MISMATCH',
  'HEAD_MISMATCH',
  'UNCHAINED_EVENT',
  'MISSING_EVENT',
  'RETENTION_BOUNDARY_MISMATCH',
  'RETENTION_SIGNATURE_INVALID',
  'STORAGE_UNAVAILABLE',
]);
export type AuditIntegrityFailureCode = z.infer<typeof AuditIntegrityFailureCodeSchema>;

export const AuditIntegrityStatusSchema = z
  .object({
    status: z.enum(['valid', 'invalid', 'unavailable']),
    chain_version: z.string().nullable(),
    schema_version: z.number().int().nonnegative().nullable(),
    anchor_sequence: z.number().int().nonnegative().nullable(),
    anchor_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    head_sequence: z.number().int().nonnegative().nullable(),
    head_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    verified_entries: z.number().int().nonnegative(),
    retention_receipts: z.number().int().nonnegative(),
    verified_at: z.string().datetime(),
    failure_code: AuditIntegrityFailureCodeSchema.nullable(),
    failure_sequence: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === 'valid') !== (value.failure_code === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['failure_code'],
        message: 'valid integrity status must have no failure code and failures must name one',
      });
    }
    if (value.status === 'valid' && value.chain_version !== AUDIT_CHAIN_VERSION) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chain_version'],
        message: 'valid integrity status must use the current chain version',
      });
    }
  });
export type AuditIntegrityStatus = z.infer<typeof AuditIntegrityStatusSchema>;
