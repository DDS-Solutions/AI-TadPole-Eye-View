import { createHash, timingSafeEqual } from 'node:crypto';
import type { SimClock } from '@gev/core';
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
      actor: 'system';
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

  constructor(
    private readonly clock: SimClock,
    private readonly windowMs = 60_000
  ) {}

  consume(bucket: string, clientId: string, limit: number): RateLimitDecision {
    const now = this.clock.now();
    const key = `${bucket}:${clientId}`;
    let window = this.windows.get(key);

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
        actor: 'system',
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

/**
 * Convenience wrapper for backwards compatibility with earlier middleware declarations.
 */
export function createOpsAuthMiddleware(options: OpsAuthOptions = {}): MiddlewareHandler {
  return createOpsAuth(options).middleware();
}
