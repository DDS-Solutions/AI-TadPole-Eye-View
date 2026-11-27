import {
  BUSINESS_CONTEXT_LIMITS,
  BusinessContextCreateRequestSchema,
  BusinessContextEncryptedBackupSchema,
  BusinessContextUpdateRequestSchema,
  type IdentityRole,
  TenantIdSchema,
  parseBoundedJsonPayload,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import {
  BusinessContextStoreError,
  type CapBudgetGovernor,
  type SqliteBudgetLedger,
  type SqliteBusinessContextStore,
} from '@gev/governance';
import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { InMemoryRateLimiter, OpsAuthAdapter } from '../middleware/opsAuth.js';

export interface BusinessContextRouterOptions {
  clock: SimClock;
  auth: OpsAuthAdapter;
  budgetGovernor: CapBudgetGovernor;
  budgetLedger?: SqliteBudgetLedger;
  businessContextStore?: SqliteBusinessContextStore;
  rateLimiter: InMemoryRateLimiter;
  isProviderEnabled?: (providerName: string) => boolean;
  requestsPerMinute?: number;
}

const DEFAULT_RATE_LIMIT = 60;

interface AuthorizedCaller {
  tenantId: string;
  actorId: string;
  role: IdentityRole;
}

function setPrivateHeaders(context: Context): void {
  context.header('Cache-Control', 'no-store');
  context.header('Vary', 'Authorization, X-GEV-Tenant');
}

function mapStoreError(context: Context, err: unknown): Response {
  setPrivateHeaders(context);
  if (err instanceof BusinessContextStoreError) {
    const statusMap: Record<BusinessContextStoreError['code'], ContentfulStatusCode> = {
      NOT_FOUND: 404,
      ALREADY_EXISTS: 409,
      VERSION_CONFLICT: 409,
      LEGAL_HOLD_ACTIVE: 409,
      TENANT_MISMATCH: 403,
      INVALID_INPUT: 400,
      INTEGRITY_ERROR: 500,
    };
    return context.json({ error: err.message, code: err.code }, statusMap[err.code]);
  }
  return context.json(
    { error: 'BusinessContext persistence operation failed', code: 'PERSISTENCE_ERROR' },
    500
  );
}

async function readBoundedBody(
  context: Context,
  maxBytes: number = BUSINESS_CONTEXT_LIMITS.maxPayloadBytes
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const rawText = await context.req.text();
  const bytes = Buffer.byteLength(rawText, 'utf8');
  if (bytes > maxBytes) {
    setPrivateHeaders(context);
    return {
      ok: false,
      response: context.json(
        {
          error: `Payload size (${bytes} bytes) exceeds ${maxBytes} byte limit`,
          code: 'PAYLOAD_TOO_LARGE',
        },
        413
      ),
    };
  }
  try {
    return { ok: true, data: parseBoundedJsonPayload(rawText, maxBytes) };
  } catch (err) {
    setPrivateHeaders(context);
    return {
      ok: false,
      response: context.json(
        {
          error: err instanceof Error ? err.message : 'Invalid JSON payload',
          code: 'INVALID_INPUT',
        },
        400
      ),
    };
  }
}

export function createBusinessContextRouter(options: BusinessContextRouterOptions): Hono {
  const router = new Hono();
  const rateLimit = options.requestsPerMinute ?? DEFAULT_RATE_LIMIT;

  async function authorize(
    context: Context,
    allowedRoles: readonly IdentityRole[]
  ): Promise<{ ok: true; caller: AuthorizedCaller } | { ok: false; response: Response }> {
    setPrivateHeaders(context);
    if (!options.businessContextStore) {
      return {
        ok: false,
        response: context.json(
          { error: 'BusinessContext persistence store unavailable', code: 'STORE_UNAVAILABLE' },
          503
        ),
      };
    }

    const authHeader = context.req.header('Authorization');
    const requestedTenant = context.req.header('X-GEV-Tenant');
    const decision = await options.auth.authenticate(authHeader, requestedTenant, {
      allowedRoles: [...allowedRoles],
      allowLocalSeed: true,
    });
    if (!decision.allowed) {
      return {
        ok: false,
        response: context.json({ error: decision.error, code: decision.code }, decision.status),
      };
    }

    let tenantId = 'tenant-local';
    let actorId = 'system';
    let role: IdentityRole = 'tenant_admin';
    if (decision.kind === 'authenticated') {
      tenantId = decision.identity.tenant_id;
      actorId = decision.identity.principal;
      role = decision.identity.role;
    } else if (options.auth.config.requireAuth) {
      return {
        ok: false,
        response: context.json(
          { error: 'Unauthorized: Authenticated tenant required', code: 'UNAUTHENTICATED_ACCESS' },
          401
        ),
      };
    }

    if (!TenantIdSchema.safeParse(tenantId).success) {
      return {
        ok: false,
        response: context.json(
          { error: 'Unauthorized: Invalid tenant identifier', code: 'INVALID_BEARER_TOKEN' },
          401
        ),
      };
    }

    if (options.isProviderEnabled && !options.isProviderEnabled('economic')) {
      return {
        ok: false,
        response: context.json(
          {
            error: "Provider 'economic' is disabled by kill-switch policy",
            code: 'KILL_SWITCH_ACTIVE',
          },
          503
        ),
      };
    }

    if (options.budgetGovernor.state().stasis_active) {
      return {
        ok: false,
        response: context.json(
          { error: 'STASIS: BusinessContext persistence is suspended', code: 'STASIS_ACTIVE' },
          423
        ),
      };
    }

    if (options.budgetLedger) {
      const tenantBudget = options.budgetLedger.getTenantBudget(tenantId);
      if (tenantBudget.stasis_active === 1) {
        return {
          ok: false,
          response: context.json(
            {
              error: `STASIS: BusinessContext persistence suspended for tenant '${tenantId}'`,
              code: 'TENANT_STASIS_ACTIVE',
            },
            423
          ),
        };
      }
    }

    const rateDecision = options.rateLimiter.consume('business-context-store', tenantId, rateLimit);
    if (!rateDecision.allowed) {
      context.header('Retry-After', String(rateDecision.retryAfterSeconds));
      context.header('X-GEV-Tenant-Rate-Limited', 'true');
      return {
        ok: false,
        response: context.json(
          { error: 'Rate limit exceeded for BusinessContext store', code: 'RATE_LIMITED' },
          429
        ),
      };
    }

    return { ok: true, caller: { tenantId, actorId, role } };
  }

  router.post('/contexts', async (context) => {
    const authRes = await authorize(context, ['operator', 'tenant_admin', 'platform_admin']);
    if (!authRes.ok) return authRes.response;

    const bodyRes = await readBoundedBody(context);
    if (!bodyRes.ok) return bodyRes.response;

    const parsed = BusinessContextCreateRequestSchema.safeParse(bodyRes.data);
    if (!parsed.success) {
      return context.json(
        {
          error: 'Invalid BusinessContext create payload',
          code: 'INVALID_INPUT',
          details: parsed.error.issues,
        },
        400
      );
    }

    try {
      const taskRef = context.req.header('X-Task-Ref') || 'business-context-http-create';
      const created = options.businessContextStore?.createContext(
        authRes.caller.tenantId,
        parsed.data,
        authRes.caller.actorId,
        taskRef
      );
      return context.json(created, 201);
    } catch (err) {
      return mapStoreError(context, err);
    }
  });

  router.get('/contexts', async (context) => {
    const authRes = await authorize(context, [
      'operator',
      'tenant_admin',
      'platform_admin',
      'ai_copilot',
    ]);
    if (!authRes.ok) return authRes.response;
    try {
      const items = options.businessContextStore?.listContexts(authRes.caller.tenantId) ?? [];
      return context.json({ tenant_id: authRes.caller.tenantId, count: items.length, items }, 200);
    } catch (err) {
      return mapStoreError(context, err);
    }
  });

  router.post('/contexts/restore', async (context) => {
    const authRes = await authorize(context, ['tenant_admin', 'platform_admin']);
    if (!authRes.ok) return authRes.response;

    const bodyRes = await readBoundedBody(context, 524_288);
    if (!bodyRes.ok) return bodyRes.response;

    const parsed = BusinessContextEncryptedBackupSchema.safeParse(bodyRes.data);
    if (!parsed.success) {
      return context.json(
        {
          error: 'Invalid encrypted BusinessContext backup payload',
          code: 'INVALID_INPUT',
          details: parsed.error.issues,
        },
        400
      );
    }

    try {
      const taskRef = context.req.header('X-Task-Ref') || 'business-context-http-restore';
      const restored = options.businessContextStore?.restoreBackup(
        authRes.caller.tenantId,
        parsed.data,
        authRes.caller.actorId,
        taskRef
      );
      return context.json(restored, 201);
    } catch (err) {
      return mapStoreError(context, err);
    }
  });

  router.post('/contexts/retention/purge', async (context) => {
    const authRes = await authorize(context, ['tenant_admin', 'platform_admin']);
    if (!authRes.ok) return authRes.response;
    try {
      const taskRef = context.req.header('X-Task-Ref') || 'business-context-http-purge';
      const result = options.businessContextStore?.purgeExpiredContexts(
        authRes.caller.actorId,
        taskRef,
        authRes.caller.tenantId
      );
      return context.json(result, 200);
    } catch (err) {
      return mapStoreError(context, err);
    }
  });

  router.get('/contexts/:contextId', async (context) => {
    const authRes = await authorize(context, ['operator', 'tenant_admin', 'platform_admin']);
    if (!authRes.ok) return authRes.response;

    const versionParam = context.req.query('version');
    let version: number | undefined;
    if (versionParam !== undefined) {
      const parsedVersion = Number(versionParam);
      if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
        return context.json(
          { error: 'Invalid version query parameter', code: 'INVALID_INPUT' },
          400
        );
      }
      version = parsedVersion;
    }

    try {
      const found = options.businessContextStore?.getContext(
        authRes.caller.tenantId,
        context.req.param('contextId'),
        version
      );
      if (!found) {
        return context.json({ error: 'BusinessContext not found', code: 'NOT_FOUND' }, 404);
      }
      return context.json(found, 200);
    } catch (err) {
      return mapStoreError(context, err);
    }
  });

  router.put('/contexts/:contextId', async (context) => {
    const authRes = await authorize(context, ['operator', 'tenant_admin', 'platform_admin']);
    if (!authRes.ok) return authRes.response;

    const bodyRes = await readBoundedBody(context);
    if (!bodyRes.ok) return bodyRes.response;

    const parsed = BusinessContextUpdateRequestSchema.safeParse(bodyRes.data);
    if (!parsed.success) {
      return context.json(
        {
          error: 'Invalid BusinessContext update payload',
          code: 'INVALID_INPUT',
          details: parsed.error.issues,
        },
        400
      );
    }

    try {
      const taskRef = context.req.header('X-Task-Ref') || 'business-context-http-update';
      const updated = options.businessContextStore?.updateContext(
        authRes.caller.tenantId,
        context.req.param('contextId'),
        parsed.data,
        authRes.caller.actorId,
        taskRef
      );
      return context.json(updated, 200);
    } catch (err) {
      return mapStoreError(context, err);
    }
  });

  router.get('/contexts/:contextId/export', async (context) => {
    const authRes = await authorize(context, ['tenant_admin', 'platform_admin']);
    if (!authRes.ok) return authRes.response;
    try {
      const taskRef = context.req.header('X-Task-Ref') || 'business-context-http-export';
      const bundle = options.businessContextStore?.exportContext(
        authRes.caller.tenantId,
        context.req.param('contextId'),
        authRes.caller.actorId,
        taskRef
      );
      return context.json(bundle, 200);
    } catch (err) {
      return mapStoreError(context, err);
    }
  });

  router.post('/contexts/:contextId/backup', async (context) => {
    const authRes = await authorize(context, ['tenant_admin', 'platform_admin']);
    if (!authRes.ok) return authRes.response;
    try {
      const taskRef = context.req.header('X-Task-Ref') || 'business-context-http-backup';
      const backup = options.businessContextStore?.backupContext(
        authRes.caller.tenantId,
        context.req.param('contextId'),
        authRes.caller.actorId,
        taskRef
      );
      return context.json(backup, 200);
    } catch (err) {
      return mapStoreError(context, err);
    }
  });

  router.delete('/contexts/:contextId', async (context) => {
    const authRes = await authorize(context, ['tenant_admin', 'platform_admin']);
    if (!authRes.ok) return authRes.response;
    try {
      const taskRef = context.req.header('X-Task-Ref') || 'business-context-http-delete';
      const forceLegalHold =
        context.req.query('force_legal_hold') === '1' && authRes.caller.role === 'platform_admin';
      const receipt = options.businessContextStore?.deleteContext(
        authRes.caller.tenantId,
        context.req.param('contextId'),
        authRes.caller.actorId,
        taskRef,
        { forceLegalHold }
      );
      return context.json(receipt, 200);
    } catch (err) {
      return mapStoreError(context, err);
    }
  });

  return router;
}
