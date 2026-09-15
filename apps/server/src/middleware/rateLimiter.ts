import type { AuthenticatedIdentityContext } from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type { Context, MiddlewareHandler, Next } from 'hono';

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
