import { z } from 'zod';

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
