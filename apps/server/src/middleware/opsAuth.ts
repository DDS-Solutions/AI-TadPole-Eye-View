import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type AuthenticatedIdentityContext,
  AuthenticatedIdentityContextSchema,
  GEV_PRODUCTION_IDENTITY_PROFILE,
  type IdentityBearerVerifier,
  type IdentityRole,
  IdentityBearerVerificationRequestSchema,
  TenantIdSchema,
  authorizeTenantResource,
  identityIsCurrent,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { SystemClock } from '@gev/core';
import type { Context, Hono, MiddlewareHandler, Next } from 'hono';

export interface OpsAuthOptions {
  opsToken?: string;
  requireAuth?: boolean;
  bearerVerifier?: IdentityBearerVerifier;
  expectedIssuer?: string;
  resource?: string;
  clock?: SimClock;
}

export interface ResolvedOpsAuthConfig {
  configured: boolean;
  requireAuth: boolean;
}

export type OpsAuthDecision =
  | {
      kind: 'authenticated';
      allowed: true;
      authenticated: true;
      actor: AuthenticatedIdentityContext['actor'];
      identity: AuthenticatedIdentityContext;
    }
  | {
      kind: 'local_seed';
      allowed: true;
      authenticated: false;
      actor: 'system';
    }
  | {
      kind: 'denied';
      allowed: false;
      authenticated: false;
      status: 401 | 403 | 503;
      code:
        | 'AUTH_NOT_CONFIGURED'
        | 'MISSING_BEARER_TOKEN'
        | 'INVALID_BEARER_TOKEN'
        | 'TENANT_ACCESS_DENIED'
        | 'ROLE_ACCESS_DENIED'
        | 'INSUFFICIENT_SCOPE';
      error: string;
    };

export interface OpsAuthorizationPolicy {
  allowedRoles: readonly IdentityRole[];
  requiredScopes?: readonly AuthenticatedIdentityContext['scopes'][number][];
}

export interface OpsAuthAdapter {
  readonly config: Readonly<ResolvedOpsAuthConfig>;
  authorize(authorization?: string): OpsAuthDecision;
  authenticate(
    authorization?: string,
    requestedTenantId?: string,
    policy?: OpsAuthorizationPolicy
  ): Promise<OpsAuthDecision>;
  middleware(policy?: OpsAuthorizationPolicy): MiddlewareHandler;
}

const PLATFORM_ADMIN_OPS_PATHS = [
  '/ops/audit',
  '/ops/audit/*',
  '/ops/budget/*',
  '/ops/cables/*',
  '/ops/seed/*',
  '/ops/resume',
] as const;

/** Installs the closed role matrix before any protected operations route is registered. */
export function mountOpsAuthorization(app: Hono, auth: OpsAuthAdapter): void {
  app.use(
    '/ops/*',
    auth.middleware({ allowedRoles: ['operator', 'tenant_admin', 'platform_admin'] })
  );
  const platformAdmin = auth.middleware({ allowedRoles: ['platform_admin'] });
  for (const path of PLATFORM_ADMIN_OPS_PATHS) app.use(path, platformAdmin);
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface RateLimitWindow {
  count: number;
  startedAtMs: number;
}

/** Shared, clock-injected fixed-window protection for bounded in-memory surfaces. */
export class InMemoryRateLimiter {
  private readonly windows = new Map<string, RateLimitWindow>();
  private readonly maxEntries = 5000;

  constructor(
    private readonly clock: SimClock,
    private readonly windowMs = 60_000
  ) {}

  private prune(now: number): void {
    for (const [k, w] of this.windows.entries()) {
      if (now - w.startedAtMs >= this.windowMs) {
        this.windows.delete(k);
      }
    }
  }

  consume(bucket: string, clientId: string, limit: number): RateLimitDecision {
    const now = this.clock.now();
    const key = `${bucket}:${clientId}`;
    let window = this.windows.get(key);

    if (this.windows.size > this.maxEntries) {
      this.prune(now);
    }

    if (!window || now - window.startedAtMs >= this.windowMs) {
      window = { count: 0, startedAtMs: now };
      this.windows.set(key, window);
    }

    if (window.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((window.startedAtMs + this.windowMs - now) / 1000)
        ),
      };
    }

    window.count += 1;
    return {
      allowed: true,
      remaining: limit - window.count,
      retryAfterSeconds: 0,
    };
  }
}

export interface RateLimitMiddlewareOptions {
  bucket: string;
  limit: number;
  resolveClientId: (c: Context) => string;
}

export function createRateLimitMiddleware(
  limiter: InMemoryRateLimiter,
  options: RateLimitMiddlewareOptions
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const decision = limiter.consume(options.bucket, options.resolveClientId(c), options.limit);
    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSeconds));
      return c.json({ error: 'Rate limit exceeded', code: 'RATE_LIMITED' }, 429);
    }
    return await next();
  };
}

export function resolveRequestTenantId(c: Context, fallback?: string): string | undefined {
  return (
    (c.get('opsTenantId') as string | undefined) ??
    (c.get('opsIdentity') as AuthenticatedIdentityContext | undefined)?.tenant_id ??
    (c.var as { opsTenantId?: string } | undefined)?.opsTenantId ??
    fallback
  );
}

export interface TenantRateLimitMiddlewareOptions {
  bucket: string;
  limit: number;
  fallbackTenantId?: string;
}

export function createTenantRateLimitMiddleware(
  limiter: InMemoryRateLimiter,
  options: TenantRateLimitMiddlewareOptions
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const tenantId = resolveRequestTenantId(c, options.fallbackTenantId);

    if (!tenantId) {
      return c.json(
        {
          error: 'Unauthorized: Authenticated tenant required for rate-limited endpoint',
          code: 'UNAUTHENTICATED_QUOTA_ACCESS',
        },
        401
      );
    }

    const decision = limiter.consume(options.bucket, tenantId, options.limit);
    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSeconds));
      c.header('X-GEV-Tenant-Rate-Limited', 'true');
      return c.json(
        {
          error: `Per-tenant rate limit exceeded for tenant '${tenantId}'`,
          code: 'TENANT_RATE_LIMITED',
        },
        429
      );
    }
    return await next();
  };
}


function normalizedTokenDigest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Compares fixed-length token digests so unequal input lengths cannot make
 * timingSafeEqual throw or introduce a raw length-dependent early return.
 */
export function timingSafeTokenMatches(presentedToken: string, expectedToken: string): boolean {
  return timingSafeEqual(
    normalizedTokenDigest(presentedToken),
    normalizedTokenDigest(expectedToken)
  );
}

function extractBearerToken(authorization?: string): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  return match?.[1];
}

function denied(
  status: 401 | 403 | 503,
  code: Extract<OpsAuthDecision, { kind: 'denied' }>['code'],
  error: string
): OpsAuthDecision {
  return {
    kind: 'denied',
    allowed: false,
    authenticated: false,
    status,
    code,
    error,
  };
}

function authorizationDenied(
  code: 'TENANT_ACCESS_DENIED' | 'ROLE_ACCESS_DENIED' | 'INSUFFICIENT_SCOPE'
): OpsAuthDecision {
  const errors = {
    TENANT_ACCESS_DENIED: 'Forbidden: requested tenant is not the authenticated membership',
    ROLE_ACCESS_DENIED: 'Forbidden: identity role is not permitted for this resource',
    INSUFFICIENT_SCOPE: 'Forbidden: identity lacks a required capability scope',
  } as const;
  return denied(403, code, errors[code]);
}

function localCompatibilityIdentity(
  clock: SimClock,
  resource: string
): AuthenticatedIdentityContext {
  const now = Math.floor(clock.now() / 1000);
  return AuthenticatedIdentityContextSchema.parse({
    actor: 'human',
    principal: 'human:local-operator',
    tenant_id: 'tenant-local',
    role: 'platform_admin',
    client_id: 'gev-local-ops',
    token_id: 'local-ops-token',
    issuer: 'https://auth.gev.local/',
    audience: resource,
    resource,
    scopes: ['read.telemetry', 'read.audit', 'write.scenes', 'write.flags'],
    issued_at_epoch_seconds: Math.max(0, now - 1),
    not_before_epoch_seconds: Math.max(0, now - 1),
    expires_at_epoch_seconds: now + 299,
  });
}

/**
 * Creates one immutable authentication policy for every privileged server surface.
 * Environment values are resolved once during application composition.
 */
export function createOpsAuth(options: OpsAuthOptions = {}): OpsAuthAdapter {
  const production = process.env.NODE_ENV === 'production';
  const configuredToken = production
    ? undefined
    : (options.opsToken ?? process.env.GEV_OPS_TOKEN)?.trim() || undefined;
  const bearerVerifier = options.bearerVerifier;
  const clock = options.clock ?? new SystemClock();
  const expectedIssuer = options.expectedIssuer ?? GEV_PRODUCTION_IDENTITY_PROFILE.issuer;
  const resource = options.resource ?? GEV_PRODUCTION_IDENTITY_PROFILE.rest_resource;
  const requireAuth = production || (options.requireAuth ?? process.env.GEV_REQUIRE_AUTH === '1');
  const expectedDigest = configuredToken ? normalizedTokenDigest(configuredToken) : undefined;
  const config = Object.freeze({
    configured: bearerVerifier !== undefined || expectedDigest !== undefined,
    requireAuth,
  });

  const authorize = (authorization?: string): OpsAuthDecision => {
    if (!expectedDigest && !bearerVerifier) {
      if (requireAuth) {
        return denied(
          503,
          'AUTH_NOT_CONFIGURED',
          'Privileged server surfaces disabled: identity verification is not configured'
        );
      }

      return {
        kind: 'local_seed',
        allowed: true,
        authenticated: false,
        actor: 'system',
      };
    }

    const presentedToken = extractBearerToken(authorization);
    if (!presentedToken) {
      return denied(
        401,
        'MISSING_BEARER_TOKEN',
        'Unauthorized: Bearer token required for privileged server access'
      );
    }

    if (
      !expectedDigest ||
      !timingSafeEqual(normalizedTokenDigest(presentedToken), expectedDigest)
    ) {
      return denied(401, 'INVALID_BEARER_TOKEN', 'Unauthorized: Invalid privileged credentials');
    }

    const identity = localCompatibilityIdentity(clock, resource);
    return {
      kind: 'authenticated',
      allowed: true,
      authenticated: true,
      actor: identity.actor,
      identity,
    };
  };

  const tokenCache = new Map<
    string,
    { identity: AuthenticatedIdentityContext; expiresAtEpochSeconds: number }
  >();

  const authenticate = async (
    authorization?: string,
    requestedTenantId?: string,
    policy?: OpsAuthorizationPolicy
  ): Promise<OpsAuthDecision> => {
    const localDecision = authorize(authorization);
    let identity: AuthenticatedIdentityContext | undefined;
    if (localDecision.kind === 'authenticated') {
      identity = localDecision.identity;
    } else if (bearerVerifier) {
      const accessToken = extractBearerToken(authorization);
      if (!accessToken) return localDecision;
      const nowEpochSeconds = Math.floor(clock.now() / 1000);
      const cached = tokenCache.get(accessToken);
      if (cached && nowEpochSeconds < cached.expiresAtEpochSeconds) {
        identity = cached.identity;
      } else {
        const verificationRequest = IdentityBearerVerificationRequestSchema.safeParse({
          access_token: accessToken,
          audience: resource,
          resource,
          now_epoch_seconds: nowEpochSeconds,
        });
        if (!verificationRequest.success) {
          return denied(401, 'INVALID_BEARER_TOKEN', 'Unauthorized: Invalid privileged credentials');
        }
        try {
          const parsed = AuthenticatedIdentityContextSchema.safeParse(
            await bearerVerifier.verify(Object.freeze(verificationRequest.data))
          );
          if (
            !parsed.success ||
            parsed.data.issuer !== expectedIssuer ||
            parsed.data.audience !== resource ||
            parsed.data.resource !== resource ||
            !identityIsCurrent(parsed.data, nowEpochSeconds)
          ) {
            return denied(
              401,
              'INVALID_BEARER_TOKEN',
              'Unauthorized: Invalid privileged credentials'
            );
          }
          identity = Object.freeze({
            ...parsed.data,
            scopes: Object.freeze([...parsed.data.scopes]),
          }) as AuthenticatedIdentityContext;
          if (tokenCache.size >= 1000) tokenCache.clear();
          tokenCache.set(accessToken, {
            identity,
            expiresAtEpochSeconds: parsed.data.expires_at_epoch_seconds,
          });
        } catch {
          return denied(401, 'INVALID_BEARER_TOKEN', 'Unauthorized: Invalid privileged credentials');
        }
      }
    } else {
      return localDecision.kind === 'local_seed' && policy
        ? denied(
            401,
            'MISSING_BEARER_TOKEN',
            'Unauthorized: Bearer token required for privileged server access'
          )
        : localDecision;
    }

    const requestedTenant = requestedTenantId ?? identity.tenant_id;
    if (!TenantIdSchema.safeParse(requestedTenant).success) {
      return denied(401, 'INVALID_BEARER_TOKEN', 'Unauthorized: Invalid privileged credentials');
    }
    if (policy) {
      const resourceDecision = authorizeTenantResource(identity, {
        tenant_id: requestedTenant,
        allowed_roles: [...policy.allowedRoles],
        required_scopes: [...(policy.requiredScopes ?? [])],
      });
      if (!resourceDecision.allowed) return authorizationDenied(resourceDecision.code);
    } else if (identity.tenant_id !== requestedTenant) {
      return authorizationDenied('TENANT_ACCESS_DENIED');
    }
    return {
      kind: 'authenticated',
      allowed: true,
      authenticated: true,
      actor: identity.actor,
      identity,
    };
  };

  return Object.freeze({
    config,
    authorize,
    authenticate,
    middleware: (policy?: OpsAuthorizationPolicy) => async (c: Context, next: Next) => {
      const decision = await authenticate(
        c.req.header('Authorization'),
        c.req.header('X-GEV-Tenant'),
        policy
      );
      if (!decision.allowed) {
        return c.json(
          {
            error: decision.error,
            code: decision.code,
          },
          decision.status
        );
      }

      c.set('opsActor', decision.actor);
      c.set('opsAuthenticated', decision.authenticated);
      if (decision.kind === 'authenticated') {
        c.set('opsIdentity', decision.identity);
        c.set('opsPrincipal', decision.identity.principal);
        c.set('opsTenantId', decision.identity.tenant_id);
        c.set('opsRole', decision.identity.role);
      }
      return await next();
    },
  });
}

/**
 * Convenience wrapper for backwards compatibility with earlier middleware declarations.
 */
export function createOpsAuthMiddleware(options: OpsAuthOptions = {}): MiddlewareHandler {
  return createOpsAuth(options).middleware();
}
