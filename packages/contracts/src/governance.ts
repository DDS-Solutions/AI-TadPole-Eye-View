import { z } from 'zod';

/**
 * Governance persistence authority descriptor.
 *
 * Authority variants:
 * - `shared_sqlite`: Authoritative persistent storage used across all production, staging,
 *   and development environments. Requires `authoritative=true`.
 * - `process_local`: Reserved non-authoritative fallback variant for isolated in-memory test
 *   harnesses. Fails closed (`authoritative=false`) in production environments.
 */
export const GovernanceAuthoritySchema = z
  .object({
    kind: z.enum(['shared_sqlite', 'process_local']),
    authoritative: z.boolean(),
    schema_version: z.number().int().positive(),
    state_revision: z.number().int().nonnegative(),
  })
  .superRefine((authority, context) => {
    const expected = authority.kind === 'shared_sqlite';
    if (authority.authoritative !== expected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['authoritative'],
        message: `${authority.kind} authority must set authoritative=${expected}`,
      });
    }
  });
export type GovernanceAuthority = z.infer<typeof GovernanceAuthoritySchema>;

export const OpsResumeRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(512).optional(),
  })
  .strict();
export type OpsResumeRequest = z.infer<typeof OpsResumeRequestSchema>;
