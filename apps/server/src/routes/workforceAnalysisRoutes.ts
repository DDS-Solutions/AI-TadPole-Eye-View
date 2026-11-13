import crypto from 'node:crypto';
import {
  type Actor,
  GevEvents,
  TenantIdSchema,
  WorkforceAnalysisInputSchema,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type { CapBudgetGovernor, SqliteAuditSink, SqliteBudgetLedger } from '@gev/governance';
import { resolveAndAnalyzeWorkforceContext } from '@gev/ops-mcp';
import type { BlsLauAdapter, BlsOewsAdapter } from '@gev/providers';
import { type Context, Hono } from 'hono';
import type { InMemoryRateLimiter, OpsAuthAdapter } from '../middleware/opsAuth.js';

export const DEFAULT_WORKFORCE_ANALYSIS_RATE_LIMIT = 60;

export interface WorkforceAnalysisRouterOptions {
  clock: SimClock;
  auth: OpsAuthAdapter;
  auditSink: SqliteAuditSink;
  budgetGovernor: CapBudgetGovernor;
  budgetLedger?: SqliteBudgetLedger;
  rateLimiter: InMemoryRateLimiter;
  resolveClientId: (context: Context) => string;
  isProviderEnabled?: (providerName: string) => boolean;
  oewsAdapter?: BlsOewsAdapter;
  lauAdapter?: BlsLauAdapter;
  requestsPerMinute?: number;
}

export function createWorkforceAnalysisRouter(options: WorkforceAnalysisRouterOptions): Hono {
  const router = new Hono();
  const rateLimit = options.requestsPerMinute ?? DEFAULT_WORKFORCE_ANALYSIS_RATE_LIMIT;

  // Shared governance validation helper
  async function validateGovernance(
    context: Context,
    rateBucket: string
  ): Promise<
    | {
        allowed: false;
        response: Response;
      }
    | {
        allowed: true;
        tenantId: string;
        actor: Actor;
        startedAt: number;
        taskRef: string;
      }
  > {
    const startedAt = options.clock.now();
    const authHeader = context.req.header('Authorization');
    const requestedTenant = context.req.header('X-GEV-Tenant');

    // 1. Authenticate caller & authorize tenant resource
    const decision = await options.auth.authenticate(authHeader, requestedTenant, {
      allowedRoles: ['operator', 'tenant_admin', 'platform_admin', 'ai_copilot'],
      allowLocalSeed: true,
    });

    if (!decision.allowed) {
      return {
        allowed: false,
        response: context.json(
          {
            error: decision.error,
            code: decision.code,
          },
          decision.status
        ),
      };
    }

    let tenantId = 'tenant-local';
    let actor: Actor = 'system';
    if (decision.kind === 'authenticated') {
      tenantId = decision.identity.tenant_id;
      actor = decision.actor;
    } else if (options.auth.config.requireAuth) {
      return {
        allowed: false,
        response: context.json(
          {
            error: 'Unauthorized: Authenticated tenant required for workforce analysis',
            code: 'UNAUTHENTICATED_QUOTA_ACCESS',
          },
          401
        ),
      };
    }

    if (!TenantIdSchema.safeParse(tenantId).success) {
      return {
        allowed: false,
        response: context.json(
          {
            error: 'Unauthorized: Invalid tenant identifier',
            code: 'INVALID_BEARER_TOKEN',
          },
          401
        ),
      };
    }

    // 2. Kill-Switch check
    if (options.isProviderEnabled && !options.isProviderEnabled('economic')) {
      return {
        allowed: false,
        response: context.json(
          {
            error: "Provider 'economic' is disabled by kill-switch policy",
            code: 'KILL_SWITCH_ACTIVE',
          },
          503
        ),
      };
    }

    // 3. STASIS check
    if (options.budgetGovernor.state().stasis_active) {
      return {
        allowed: false,
        response: context.json(
          {
            error: 'STASIS: economic workforce analysis reads are suspended',
            code: 'STASIS_ACTIVE',
          },
          423
        ),
      };
    }

    if (options.budgetLedger) {
      const tenantBudget = options.budgetLedger.getTenantBudget(tenantId);
      if (tenantBudget.stasis_active === 1) {
        return {
          allowed: false,
          response: context.json(
            {
              error: `STASIS: economic workforce analysis is suspended for tenant '${tenantId}'`,
              code: 'TENANT_STASIS_ACTIVE',
            },
            423
          ),
        };
      }
    }

    // 4. Per-tenant rate limit check
    const rateDecision = options.rateLimiter.consume(rateBucket, tenantId, rateLimit);
    if (!rateDecision.allowed) {
      context.header('Retry-After', String(rateDecision.retryAfterSeconds));
      context.header('X-GEV-Tenant-Rate-Limited', 'true');
      return {
        allowed: false,
        response: context.json(
          {
            error: 'Rate limit exceeded for economic workforce analysis',
            code: 'RATE_LIMITED',
          },
          429
        ),
      };
    }

    const taskRef = context.req.header('X-Task-Ref') || 'economic-workforce-analysis-http';

    return { allowed: true, tenantId, actor, startedAt, taskRef };
  }

  const logOutcome = (
    intentId: string,
    startedAt: number,
    status: 'ok' | 'error',
    resultOrError: Record<string, unknown> | string
  ) => {
    options.auditSink.outcome({
      kind: GevEvents.AuditOutcome,
      intent_id: intentId,
      ts: new Date(options.clock.now()).toISOString(),
      status,
      ...(status === 'ok'
        ? { result: resultOrError as Record<string, unknown> }
        : { error: String(resultOrError) }),
      duration_ms: options.clock.now() - startedAt,
    });
  };

  const handleWorkforceAnalysis = async (context: Context) => {
    const gov = await validateGovernance(context, 'economic-workforce-analysis');
    if (!gov.allowed) return gov.response;

    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON request payload', code: 'INVALID_INPUT' }, 400);
    }

    const parsed = WorkforceAnalysisInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return context.json(
        {
          error: 'Invalid workforce analysis input parameters',
          code: 'INVALID_INPUT',
          details: parsed.error.issues,
        },
        400
      );
    }

    const input = parsed.data;
    const intentId = crypto.randomUUID();

    // Audit intent BEFORE execution
    options.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(gov.startedAt).toISOString(),
      actor: gov.actor,
      action: 'economic.workforce.analyze',
      target: `tenant:${gov.tenantId}`,
      params: {
        soc_code: input.soc_code,
        occupation_title: input.occupation_title,
        geography: input.target_geography,
      },
      task_ref: gov.taskRef,
    });

    try {
      const result = await resolveAndAnalyzeWorkforceContext({
        clock: options.clock,
        input,
        tenantId: gov.tenantId,
        oewsAdapter: options.oewsAdapter,
        lauAdapter: options.lauAdapter,
        auditCtx: { auditSink: options.auditSink, clock: options.clock },
      });

      logOutcome(intentId, gov.startedAt, 'ok', {
        analysis_id: result.analysis_id,
        soc_code: result.soc_code,
        occupation_title: result.occupation_title,
        evidence_count: result.evidence_bundle.records.length,
        disagreement_count: result.disagreement_state.total_disagreements,
      });

      context.header('Cache-Control', 'no-store');
      context.header('Vary', 'Authorization, X-GEV-Tenant');
      return context.json(result, 200);
    } catch (err) {
      logOutcome(
        intentId,
        gov.startedAt,
        'error',
        err instanceof Error ? err.message : 'Workforce analysis calculation failed'
      );
      return context.json(
        {
          error: 'Workforce analysis calculation failed',
          code: 'WORKFORCE_ANALYSIS_FAILED',
        },
        500
      );
    }
  };

  router.post('/workforce-analysis', handleWorkforceAnalysis);
  router.post('/workforce/analyze', handleWorkforceAnalysis);

  return router;
}
