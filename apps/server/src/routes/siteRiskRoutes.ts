import crypto from 'node:crypto';
import {
  type Actor,
  GevEvents,
  SiteRiskAnalysisRequestSchema,
  TenantIdSchema,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type { CapBudgetGovernor, SqliteAuditSink, SqliteBudgetLedger } from '@gev/governance';
import { resolveAndAssessSiteRisk } from '@gev/ops-mcp';
import { type Context, Hono } from 'hono';
import type { InMemoryRateLimiter, OpsAuthAdapter } from '../middleware/opsAuth.js';

export const DEFAULT_SITE_RISK_RATE_LIMIT = 60;

export interface SiteRiskRouterOptions {
  clock: SimClock;
  auth: OpsAuthAdapter;
  auditSink: SqliteAuditSink;
  budgetGovernor: CapBudgetGovernor;
  budgetLedger?: SqliteBudgetLedger;
  rateLimiter: InMemoryRateLimiter;
  resolveClientId: (context: Context) => string;
  isProviderEnabled?: (providerName: string) => boolean;
  requestsPerMinute?: number;
}

export function createSiteRiskRouter(options: SiteRiskRouterOptions): Hono {
  const router = new Hono();
  const rateLimit = options.requestsPerMinute ?? DEFAULT_SITE_RISK_RATE_LIMIT;

  router.post('/site-risk', async (context: Context) => {
    const startedAt = options.clock.now();
    const authHeader = context.req.header('Authorization');
    const requestedTenant = context.req.header('X-GEV-Tenant');

    const decision = await options.auth.authenticate(authHeader, requestedTenant, {
      allowedRoles: ['operator', 'tenant_admin', 'platform_admin', 'ai_copilot'],
      allowLocalSeed: true,
    });

    if (!decision.allowed) {
      return context.json({ error: decision.error, code: decision.code }, decision.status);
    }

    let tenantId = 'tenant-local';
    let actor: Actor = 'system';
    if (decision.kind === 'authenticated') {
      tenantId = decision.identity.tenant_id;
      actor = decision.actor;
    } else if (options.auth.config.requireAuth) {
      return context.json(
        {
          error: 'Unauthorized: Authenticated tenant required for site-risk analysis',
          code: 'UNAUTHENTICATED_QUOTA_ACCESS',
        },
        401
      );
    }

    if (!TenantIdSchema.safeParse(tenantId).success) {
      return context.json(
        { error: 'Unauthorized: Invalid tenant identifier', code: 'INVALID_BEARER_TOKEN' },
        401
      );
    }

    if (options.isProviderEnabled && !options.isProviderEnabled('economic')) {
      return context.json(
        {
          error: "Provider 'economic' is disabled by kill-switch policy",
          code: 'KILL_SWITCH_ACTIVE',
        },
        503
      );
    }

    if (options.budgetGovernor.state().stasis_active) {
      return context.json(
        { error: 'STASIS: site-risk analysis reads are suspended', code: 'STASIS_ACTIVE' },
        423
      );
    }

    if (options.budgetLedger) {
      const tenantBudget = options.budgetLedger.getTenantBudget(tenantId);
      if (tenantBudget.stasis_active === 1) {
        return context.json(
          {
            error: `STASIS: site-risk analysis is suspended for tenant '${tenantId}'`,
            code: 'TENANT_STASIS_ACTIVE',
          },
          423
        );
      }
    }

    const rateDecision = options.rateLimiter.consume('economic-site-risk', tenantId, rateLimit);
    if (!rateDecision.allowed) {
      context.header('Retry-After', String(rateDecision.retryAfterSeconds));
      context.header('X-GEV-Tenant-Rate-Limited', 'true');
      return context.json(
        { error: 'Rate limit exceeded for economic site-risk analysis', code: 'RATE_LIMITED' },
        429
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON request payload', code: 'INVALID_INPUT' }, 400);
    }

    const parsed = SiteRiskAnalysisRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return context.json(
        {
          error: 'Invalid site-risk analysis input parameters',
          code: 'INVALID_INPUT',
          details: parsed.error.issues,
        },
        400
      );
    }

    const taskRef = context.req.header('X-Task-Ref') || 'economic-site-risk-http';
    const intentId = crypto.randomUUID();

    options.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(startedAt).toISOString(),
      actor,
      action: 'economic.site_risk.assess',
      target: `tenant:${tenantId}`,
      params: {
        tenant_id: tenantId,
        geography_level: parsed.data.geography.level,
        include_current_alerts: parsed.data.include_current_alerts,
      },
      task_ref: taskRef,
    });

    try {
      const result = await resolveAndAssessSiteRisk({
        clock: options.clock,
        input: { ...parsed.data, tenant_id: tenantId },
        tenantId,
        auditCtx: { auditSink: options.auditSink, clock: options.clock },
      });

      options.auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(options.clock.now()).toISOString(),
        status: 'ok',
        result: {
          screening_tier: result.screening_tier,
          available_signal_count: result.long_term_hazards.available_signal_count,
          active_alert_count: result.current_operational_alerts.active_alert_count,
          data_gap_count: result.data_gaps.length,
        },
        duration_ms: options.clock.now() - startedAt,
      });

      context.header('Cache-Control', 'no-store');
      context.header('Vary', 'Authorization, X-GEV-Tenant');
      return context.json(result, 200);
    } catch (err) {
      options.auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(options.clock.now()).toISOString(),
        status: 'error',
        error: err instanceof Error ? err.message : 'Site-risk screening failed',
        duration_ms: options.clock.now() - startedAt,
      });

      return context.json(
        { error: 'Site-risk screening calculation failed', code: 'SITE_RISK_FAILED' },
        500
      );
    }
  });

  return router;
}
