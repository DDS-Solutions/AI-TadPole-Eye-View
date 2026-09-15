import { z } from 'zod';
import { CapabilityScope } from './ports.js';

export const GEV_PRODUCTION_IDENTITY_PROFILE = Object.freeze({
  provider: 'auth0_organizations',
  issuer: 'https://dds-solutions-gev.us.auth0.com/',
  rest_resource: 'https://dds-solutions-gev.us.auth0.com/api/gev',
  mcp_resource: 'https://dds-solutions-gev.us.auth0.com/api/gev/mcp',
  access_token_algorithm: 'RS256',
  maximum_access_token_lifetime_seconds: 300,
  provisioning_status: 'pending',
} as const);

export const MAX_IDENTITY_ACCESS_TOKEN_SECONDS =
  GEV_PRODUCTION_IDENTITY_PROFILE.maximum_access_token_lifetime_seconds;

const PRINCIPAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@|/-]*$/;
const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TOKEN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

export const PrincipalIdSchema = z.string().min(3).max(128).regex(PRINCIPAL_PATTERN);
export const TenantIdSchema = z.string().min(1).max(128).regex(TENANT_PATTERN);
export const IdentityTokenIdSchema = z.string().min(1).max(128).regex(TOKEN_ID_PATTERN);
export const IdentityActorSchema = z.enum(['human', 'ai']);
export type IdentityActor = z.infer<typeof IdentityActorSchema>;
export const IdentityRoleSchema = z.enum([
  'viewer',
  'operator',
  'tenant_admin',
  'platform_admin',
  'ai_copilot',
]);
export type IdentityRole = z.infer<typeof IdentityRoleSchema>;

export const IdentityResourceUriSchema = z.url().min(1).max(2_048);

export const AuthenticatedIdentityContextSchema = z
  .object({
    actor: IdentityActorSchema,
    principal: PrincipalIdSchema,
    tenant_id: TenantIdSchema,
    role: IdentityRoleSchema,
    client_id: PrincipalIdSchema,
    token_id: IdentityTokenIdSchema,
    issuer: IdentityResourceUriSchema,
    audience: IdentityResourceUriSchema,
    resource: IdentityResourceUriSchema,
    scopes: z
      .array(CapabilityScope)
      .max(CapabilityScope.options.length)
      .refine((scopes) => new Set(scopes).size === scopes.length, {
        message: 'Identity capability scopes must be unique',
      }),
    issued_at_epoch_seconds: z.number().int().nonnegative(),
    not_before_epoch_seconds: z.number().int().nonnegative(),
    expires_at_epoch_seconds: z.number().int().positive(),
    session_id: IdentityTokenIdSchema.optional(),
  })
  .strict()
  .superRefine((context, refinement) => {
    if (context.audience !== context.resource) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audience'],
        message: 'Identity token audience and resource must match exactly',
      });
    }
    if (
      context.issued_at_epoch_seconds >= context.expires_at_epoch_seconds ||
      context.not_before_epoch_seconds >= context.expires_at_epoch_seconds
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expires_at_epoch_seconds'],
        message: 'Identity token validity window is invalid',
      });
    }
    if (
      context.expires_at_epoch_seconds - context.issued_at_epoch_seconds >
      MAX_IDENTITY_ACCESS_TOKEN_SECONDS
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expires_at_epoch_seconds'],
        message: `Identity access tokens may be valid for at most ${MAX_IDENTITY_ACCESS_TOKEN_SECONDS} seconds`,
      });
    }
    if (context.actor === 'ai' && context.role !== 'ai_copilot') {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['role'],
        message: 'AI identities must use the ai_copilot role',
      });
    }
    if (context.actor === 'human' && context.role === 'ai_copilot') {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['role'],
        message: 'Human identities cannot use the ai_copilot role',
      });
    }
  });
export type AuthenticatedIdentityContext = z.infer<typeof AuthenticatedIdentityContextSchema>;

export const IdentityBearerVerificationRequestSchema = z
  .object({
    access_token: z.string().min(1).max(8_192),
    audience: IdentityResourceUriSchema,
    resource: IdentityResourceUriSchema,
    now_epoch_seconds: z.number().int().nonnegative(),
  })
  .strict()
  .refine((request) => request.audience === request.resource, {
    path: ['audience'],
    message: 'Identity verification audience and resource must match',
  });
export type IdentityBearerVerificationRequest = z.infer<
  typeof IdentityBearerVerificationRequestSchema
>;

/** Injected resource-server seam. Implementations validate signatures and revocation. */
export interface IdentityBearerVerifier {
  verify(request: IdentityBearerVerificationRequest): Promise<unknown>;
}

export const TenantResourceAuthorizationRequestSchema = z
  .object({
    tenant_id: TenantIdSchema,
    allowed_roles: z
      .array(IdentityRoleSchema)
      .min(1)
      .max(IdentityRoleSchema.options.length)
      .refine((roles) => new Set(roles).size === roles.length, {
        message: 'Allowed identity roles must be unique',
      }),
    required_scopes: z
      .array(CapabilityScope)
      .max(CapabilityScope.options.length)
      .refine((scopes) => new Set(scopes).size === scopes.length, {
        message: 'Required capability scopes must be unique',
      })
      .default([]),
  })
  .strict();
export type TenantResourceAuthorizationRequest = z.input<
  typeof TenantResourceAuthorizationRequestSchema
>;

export type TenantResourceAuthorizationDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: 'TENANT_ACCESS_DENIED' | 'ROLE_ACCESS_DENIED' | 'INSUFFICIENT_SCOPE';
      missing_scopes?: readonly z.infer<typeof CapabilityScope>[];
    };

const TenantAuthorizationIdentitySchema = AuthenticatedIdentityContextSchema.safeExtend({}).strip();

/** Pure, deny-first ownership and role/capability decision shared by HTTP and MCP. */
export function authorizeTenantResource(
  rawIdentity: AuthenticatedIdentityContext,
  rawRequest: TenantResourceAuthorizationRequest
): TenantResourceAuthorizationDecision {
  // Transport contexts may add already-validated fields (for example MCP task_ref).
  // Re-validate and strip those extensions before making the shared resource decision.
  const identity = TenantAuthorizationIdentitySchema.parse(
    rawIdentity
  ) as AuthenticatedIdentityContext;
  const request = TenantResourceAuthorizationRequestSchema.parse(rawRequest);
  if (identity.tenant_id !== request.tenant_id) {
    return { allowed: false, code: 'TENANT_ACCESS_DENIED' };
  }
  if (!request.allowed_roles.includes(identity.role)) {
    return { allowed: false, code: 'ROLE_ACCESS_DENIED' };
  }
  const scopes = new Set(identity.scopes);
  const missingScopes = request.required_scopes.filter((scope) => !scopes.has(scope));
  if (missingScopes.length > 0) {
    return {
      allowed: false,
      code: 'INSUFFICIENT_SCOPE',
      missing_scopes: Object.freeze(missingScopes),
    };
  }
  return { allowed: true };
}

export function identityIsCurrent(
  identity: AuthenticatedIdentityContext,
  nowEpochSeconds: number
): boolean {
  return (
    identity.issued_at_epoch_seconds <= nowEpochSeconds &&
    identity.not_before_epoch_seconds <= nowEpochSeconds &&
    identity.expires_at_epoch_seconds > nowEpochSeconds
  );
}
