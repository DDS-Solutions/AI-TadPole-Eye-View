import type { Context, Next } from 'hono';

export interface OpsAuthOptions {
  opsToken?: string;
  requireAuth?: boolean;
}

/**
 * Deny-by-default Ops & Privileged Control Plane Authentication Middleware.
 * Guards /ops/* routes, voice session provisioning, and privileged collab join operations.
 */
export function createOpsAuthMiddleware(options: OpsAuthOptions = {}) {
  return async (c: Context, next: Next) => {
    const opsToken = options.opsToken ?? process.env.GEV_OPS_TOKEN;
    const requireAuth =
      options.requireAuth ??
      (process.env.GEV_REQUIRE_AUTH !== '0' && process.env.NODE_ENV === 'production');

    // In production or when auth is strictly required, require a configured ops token
    if (requireAuth && !opsToken) {
      return c.json(
        {
          error: 'Ops control plane disabled: GEV_OPS_TOKEN is not configured',
          code: 'AUTH_NOT_CONFIGURED',
        },
        503
      );
    }

    // If an ops token is configured, enforce strict Bearer authentication
    if (opsToken) {
      const authHeader = c.req.header('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json(
          {
            error: 'Unauthorized: Bearer token required for ops control plane',
            code: 'MISSING_BEARER_TOKEN',
          },
          401
        );
      }

      const token = authHeader.slice(7).trim();
      if (token !== opsToken) {
        return c.json(
          {
            error: 'Unauthorized: Invalid ops credentials',
            code: 'INVALID_BEARER_TOKEN',
          },
          401
        );
      }

      // Attach verified subject to request context
      c.set('opsActor', 'human');
      c.set('opsAuthenticated', true);
    } else {
      // In dev/seed mode with no opsToken configured and requireAuth=false
      c.set('opsActor', 'local-dev');
      c.set('opsAuthenticated', false);
    }

    return await next();
  };
}
