import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler, Next } from 'hono';

export interface OpsAuthOptions {
  opsToken?: string;
  requireAuth?: boolean;
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
      actor: 'human';
    }
  | {
      kind: 'local_seed';
      allowed: true;
      authenticated: false;
      actor: 'local-dev';
    }
  | {
      kind: 'denied';
      allowed: false;
      authenticated: false;
      status: 401 | 503;
      code: 'AUTH_NOT_CONFIGURED' | 'MISSING_BEARER_TOKEN' | 'INVALID_BEARER_TOKEN';
      error: string;
    };

export interface OpsAuthAdapter {
  readonly config: Readonly<ResolvedOpsAuthConfig>;
  authorize(authorization?: string): OpsAuthDecision;
  middleware(): MiddlewareHandler;
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

/**
 * Creates one immutable authentication policy for every privileged server surface.
 * Environment values are resolved once during application composition.
 */
export function createOpsAuth(options: OpsAuthOptions = {}): OpsAuthAdapter {
  const configuredToken = (options.opsToken ?? process.env.GEV_OPS_TOKEN)?.trim() || undefined;
  const requireAuth =
    process.env.NODE_ENV === 'production' ||
    (options.requireAuth ?? process.env.GEV_REQUIRE_AUTH === '1');
  const expectedDigest = configuredToken ? normalizedTokenDigest(configuredToken) : undefined;
  const config = Object.freeze({
    configured: expectedDigest !== undefined,
    requireAuth,
  });

  const authorize = (authorization?: string): OpsAuthDecision => {
    if (!expectedDigest) {
      if (requireAuth) {
        return {
          kind: 'denied',
          allowed: false,
          authenticated: false,
          status: 503,
          code: 'AUTH_NOT_CONFIGURED',
          error: 'Privileged server surfaces disabled: GEV_OPS_TOKEN is not configured',
        };
      }

      return {
        kind: 'local_seed',
        allowed: true,
        authenticated: false,
        actor: 'local-dev',
      };
    }

    const presentedToken = extractBearerToken(authorization);
    if (!presentedToken) {
      return {
        kind: 'denied',
        allowed: false,
        authenticated: false,
        status: 401,
        code: 'MISSING_BEARER_TOKEN',
        error: 'Unauthorized: Bearer token required for privileged server access',
      };
    }

    if (!timingSafeEqual(normalizedTokenDigest(presentedToken), expectedDigest)) {
      return {
        kind: 'denied',
        allowed: false,
        authenticated: false,
        status: 401,
        code: 'INVALID_BEARER_TOKEN',
        error: 'Unauthorized: Invalid privileged server credentials',
      };
    }

    return {
      kind: 'authenticated',
      allowed: true,
      authenticated: true,
      actor: 'human',
    };
  };

  return Object.freeze({
    config,
    authorize,
    middleware: () => async (c: Context, next: Next) => {
      const decision = authorize(c.req.header('Authorization'));
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
      return await next();
    },
  });
}
