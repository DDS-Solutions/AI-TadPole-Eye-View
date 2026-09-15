import { z } from 'zod';
import {
  AuthenticatedIdentityContextSchema,
  IdentityBearerVerificationRequestSchema,
  type IdentityBearerVerifier,
} from './identity.js';

/** Verified, request-local MCP authority. Raw bearer credentials never enter this shape. */
export const McpAuthorizationContextSchema = AuthenticatedIdentityContextSchema.safeExtend({
  actor: z.literal('ai'),
  role: z.literal('ai_copilot'),
  scopes: AuthenticatedIdentityContextSchema.shape.scopes.min(1),
}).safeExtend({
  task_ref: z
    .string()
    .min(1)
    .max(256)
    .refine(
      (value) =>
        [...value].every((character) => {
          const code = character.charCodeAt(0);
          return code >= 32 && code !== 127;
        }),
      'task_ref must not contain control characters'
    )
    .refine((value) => value.trim() === value, 'task_ref must not contain surrounding space'),
});
export type McpAuthorizationContext = z.infer<typeof McpAuthorizationContextSchema>;

export const McpBearerVerificationRequestSchema = IdentityBearerVerificationRequestSchema;
export type McpBearerVerificationRequest = z.infer<typeof McpBearerVerificationRequestSchema>;

/** Injected resource-server seam; implementations enforce the approved issuer, key, and revocation policy. */
export interface McpBearerVerifier extends IdentityBearerVerifier {}
