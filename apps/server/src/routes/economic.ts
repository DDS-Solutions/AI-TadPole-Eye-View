import crypto from 'node:crypto';
import { type Actor, BusinessContextInputSchema, GevEvents, TenantIdSchema } from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type { CapBudgetGovernor, SqliteAuditSink, SqliteBudgetLedger } from '@gev/governance';
import { generateBusinessContextPreview } from '@gev/ops-mcp';
import { EconomicFixtureAdapter } from '@gev/providers';
import { type Context, Hono } from 'hono';
import type { InMemoryRateLimiter, OpsAuthAdapter } from '../middleware/opsAuth.js';
import { createMarketAnalysisRouter } from './marketAnalysisRoutes.js';
import { createWorkforceAnalysisRouter } from './workforceAnalysisRoutes.js';

export const DEFAULT_ECONOMIC_RATE_LIMIT = 60;

export interface EconomicRouterOptions {
  clock: SimClock;
  auth: OpsAuthAdapter;
  auditSink: SqliteAuditSink;
  budgetGovernor: CapBudgetGovernor;
  budgetLedger?: SqliteBudgetLedger;
  rateLimiter: InMemoryRateLimiter;
  resolveClientId: (context: Context) => string;
  isProviderEnabled?: (providerName: string) => boolean;
  fixtureAdapter?: EconomicFixtureAdapter;
  requestsPerMinute?: number;
}

export function createEconomicRouter(options: EconomicRouterOptions): Hono {
  const router = new Hono();
  const adapter = options.fixtureAdapter ?? new EconomicFixtureAdapter({ clock: options.clock });
  const rateLimit = options.requestsPerMinute ?? DEFAULT_ECONOMIC_RATE_LIMIT;

  const handlePreview = async (context: Context) => {
    const startedAt = options.clock.now();
    const authHeader = context.req.header('Authorization');
    const requestedTenant = context.req.header('X-GEV-Tenant');

    // 1. Authenticate caller & authorize tenant resource
    const decision = await options.auth.authenticate(authHeader, requestedTenant, {
      allowedRoles: ['operator', 'tenant_admin', 'platform_admin', 'ai_copilot'],
      allowLocalSeed: true,
    });

    if (!decision.allowed) {
      return context.json(
        {
          error: decision.error,
          code: decision.code,
        },
        decision.status
      );
    }

    // Resolve tenant identity
    let tenantId = 'tenant-local';
    let actor: Actor = 'system';
    if (decision.kind === 'authenticated') {
      tenantId = decision.identity.tenant_id;
      actor = decision.actor;
    } else if (options.auth.config.requireAuth) {
      return context.json(
        {
          error: 'Unauthorized: Authenticated tenant required for economic preview',
          code: 'UNAUTHENTICATED_QUOTA_ACCESS',
        },
        401
      );
    }

    // Validate tenant ID format
    if (!TenantIdSchema.safeParse(tenantId).success) {
      return context.json(
        {
          error: 'Unauthorized: Invalid tenant identifier',
          code: 'INVALID_BEARER_TOKEN',
        },
        401
      );
    }

    // 2. Kill-Switch check (fail closed immediately)
    if (options.isProviderEnabled && !options.isProviderEnabled('economic')) {
      return context.json(
        {
          error: "Provider 'economic' is disabled by kill-switch policy",
          code: 'KILL_SWITCH_ACTIVE',
        },
        503
      );
    }

    // 3. STASIS check (global and tenant)
    if (options.budgetGovernor.state().stasis_active) {
      return context.json(
        {
          error: 'STASIS: economic preview reads are suspended',
          code: 'STASIS_ACTIVE',
        },
        423
      );
    }

    if (options.budgetLedger) {
      const tenantBudget = options.budgetLedger.getTenantBudget(tenantId);
      if (tenantBudget.stasis_active === 1) {
        return context.json(
          {
            error: `STASIS: economic preview is suspended for tenant '${tenantId}'`,
            code: 'TENANT_STASIS_ACTIVE',
          },
          423
        );
      }
    }

    // 4. Per-tenant rate limit check
    const rateDecision = options.rateLimiter.consume('economic-preview', tenantId, rateLimit);
    if (!rateDecision.allowed) {
      context.header('Retry-After', String(rateDecision.retryAfterSeconds));
      context.header('X-GEV-Tenant-Rate-Limited', 'true');
      return context.json(
        {
          error: 'Rate limit exceeded for economic preview',
          code: 'RATE_LIMITED',
        },
        429
      );
    }

    // 5. Parse request body
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      return context.json(
        {
          error: 'Invalid JSON request payload',
          code: 'INVALID_INPUT',
        },
        400
      );
    }

    const parsedInput = BusinessContextInputSchema.safeParse(rawBody);
    if (!parsedInput.success) {
      return context.json(
        {
          error: 'Invalid business context input parameters',
          code: 'INVALID_INPUT',
          details: parsedInput.error.issues,
        },
        400
      );
    }

    // 6. Audit intent BEFORE execution
    const intentId = crypto.randomUUID();
    const taskRef = context.req.header('X-Task-Ref') || 'economic-preview-http';
    options.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(startedAt).toISOString(),
      actor,
      action: 'economic.business_context.preview',
      target: `tenant:${tenantId}`,
      params: {
        business_name: parsedInput.data.business_name,
        naics_code: parsedInput.data.naics_code,
        geography: parsedInput.data.target_geography,
      },
      task_ref: taskRef,
    });

    // 7. Stateless execution
    try {
      const preview = generateBusinessContextPreview({
        input: parsedInput.data,
        tenantId,
        clock: options.clock,
        fixtureAdapter: adapter,
      });

      // 8. Audit outcome AFTER successful execution
      options.auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(options.clock.now()).toISOString(),
        status: 'ok',
        result: {
          preview_id: preview.preview_id,
          evidence_count: preview.evidence.length,
          summary_estimate_count: Object.keys(preview.summary_estimates).length,
        },
        duration_ms: options.clock.now() - startedAt,
      });

      context.header('Cache-Control', 'no-store');
      context.header('Vary', 'Authorization, X-GEV-Tenant');
      return context.json(preview, 200);
    } catch (err) {
      options.auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(options.clock.now()).toISOString(),
        status: 'error',
        error: err instanceof Error ? err.message : 'Economic preview synthesis failed',
        duration_ms: options.clock.now() - startedAt,
      });

      return context.json(
        {
          error: 'Economic preview calculation failed',
          code: 'PREVIEW_SYNTHESIS_FAILED',
        },
        500
      );
    }
  };

  router.post('/preview', handlePreview);
  router.post('/business-context/preview', handlePreview);

  router.route('/', createMarketAnalysisRouter(options));
  router.route('/', createWorkforceAnalysisRouter(options));

  return router;
}
