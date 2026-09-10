import { z } from 'zod';
import { CapabilityScope } from './ports.js';

const PRINCIPAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const boundedUri = z.string().url().min(1).max(2_048);

/** Verified, request-local MCP authority. Raw bearer credentials never enter this shape. */
export const McpAuthorizationContextSchema = z
  .object({
    actor: z.literal('ai'),
    principal: z.string().min(3).max(128).regex(PRINCIPAL_PATTERN),
    tenant_id: z.string().min(1).max(128).regex(TENANT_PATTERN),
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
    issuer: boundedUri,
    audience: boundedUri,
    resource: boundedUri,
    scopes: z
      .array(CapabilityScope)
      .min(1)
      .max(CapabilityScope.options.length)
      .refine((scopes) => new Set(scopes).size === scopes.length, {
        message: 'MCP capability scopes must be unique',
      }),
    issued_at_epoch_seconds: z.number().int().nonnegative(),
    not_before_epoch_seconds: z.number().int().nonnegative(),
    expires_at_epoch_seconds: z.number().int().positive(),
  })
  .strict()
  .superRefine((context, refinement) => {
    if (context.audience !== context.resource) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audience'],
        message: 'MCP token audience and resource must match',
      });
    }
    if (
      context.issued_at_epoch_seconds >= context.expires_at_epoch_seconds ||
      context.not_before_epoch_seconds >= context.expires_at_epoch_seconds
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expires_at_epoch_seconds'],
        message: 'MCP token validity window is invalid',
      });
    }
  });
export type McpAuthorizationContext = z.infer<typeof McpAuthorizationContextSchema>;

export const McpBearerVerificationRequestSchema = z
  .object({
    access_token: z.string().min(1).max(8_192),
    audience: boundedUri,
    resource: boundedUri,
    now_epoch_seconds: z.number().int().nonnegative(),
  })
  .strict()
  .refine((request) => request.audience === request.resource, {
    path: ['audience'],
    message: 'MCP verification audience and resource must match',
  });
export type McpBearerVerificationRequest = z.infer<typeof McpBearerVerificationRequestSchema>;

/** Injected resource-server seam; production remains unconfigured until an issuer is approved. */
export interface McpBearerVerifier {
  verify(request: McpBearerVerificationRequest): Promise<unknown>;
}
