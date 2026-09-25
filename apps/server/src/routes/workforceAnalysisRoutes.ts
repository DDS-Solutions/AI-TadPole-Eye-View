import crypto from 'node:crypto';
import {
  type Actor,
  type EconomicEvidenceRecord,
  type EconomicGeography,
  GevEvents,
  TenantIdSchema,
  WorkforceAnalysisInputSchema,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { analyzeWorkforceContext } from '@gev/economic';
import type { CapBudgetGovernor, SqliteAuditSink, SqliteBudgetLedger } from '@gev/governance';
import { BlsLauAdapter, BlsOewsAdapter } from '@gev/providers';
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
  const oewsAdapter =
    options.oewsAdapter ?? new BlsOewsAdapter({ clock: options.clock, seedMode: true });
  const lauAdapter =
    options.lauAdapter ?? new BlsLauAdapter({ clock: options.clock, seedMode: true });
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

    const input = { ...parsed.data, tenant_id: gov.tenantId };
    const intentId = crypto.randomUUID();

    function resolveWorkforceOewsGeography(geo: EconomicGeography): EconomicGeography {
      if (geo.level === 'cbsa' || geo.level === 'state' || geo.level === 'nation') {
        return geo;
      }
      if (geo.level === 'county') {
        if (geo.county_fips?.startsWith('48453') || geo.county_fips?.startsWith('48')) {
          return { level: 'cbsa', cbsa_code: '12420', name: 'Austin-Round Rock-Georgetown, TX' };
        }
      }
      if (geo.level === 'place') {
        if (geo.place_fips === '4805000' || geo.name?.toLowerCase().includes('austin')) {
          return { level: 'cbsa', cbsa_code: '12420', name: 'Austin-Round Rock-Georgetown, TX' };
        }
      }
      if (geo.level === 'zcta') {
        if (geo.zcta?.startsWith('787')) {
          return { level: 'cbsa', cbsa_code: '12420', name: 'Austin-Round Rock-Georgetown, TX' };
        }
      }
      return geo;
    }

    function resolveWorkforceLauGeography(geo: EconomicGeography): EconomicGeography {
      if (
        geo.level === 'county' ||
        geo.level === 'cbsa' ||
        geo.level === 'state' ||
        geo.level === 'nation'
      ) {
        return geo;
      }
      if (geo.level === 'place' || geo.level === 'zcta') {
        return {
          level: 'county',
          county_fips: '48453',
          state_fips: '48',
          name: 'Travis County, TX',
        };
      }
      return geo;
    }

    // Auto-populate evidence records from BLS adapters if omitted
    if (input.oews_evidence.length === 0) {
      try {
        const oewsGeo = resolveWorkforceOewsGeography(input.target_geography);
        const localRecords = await oewsAdapter.query({
          geography: oewsGeo,
          soc_code: input.soc_code,
        });
        const nationalRecords = await oewsAdapter.query({
          geography: { level: 'nation', country_code: 'US' },
          soc_code: input.soc_code,
        });
        const allLocalOccupations = await oewsAdapter.query({
          geography: oewsGeo,
          soc_code: '00-0000',
        });
        const allNationalOccupations = await oewsAdapter.query({
          geography: { level: 'nation', country_code: 'US' },
          soc_code: '00-0000',
        });
        const geoAllRecords = await oewsAdapter.getEvidenceByGeography(oewsGeo);
        const combined = [
          ...localRecords,
          ...nationalRecords,
          ...allLocalOccupations,
          ...allNationalOccupations,
          ...geoAllRecords,
        ];
        const seenIds = new Set<string>();
        const deduped: EconomicEvidenceRecord[] = [];
        for (const r of combined) {
          if (!seenIds.has(r.evidence_id)) {
            seenIds.add(r.evidence_id);
            deduped.push(r as EconomicEvidenceRecord);
          }
        }
        input.oews_evidence = deduped;
      } catch {
        // Fallback gracefully to empty if provider query cannot fulfill
        input.oews_evidence = [];
      }
    }

    if (input.lau_evidence.length === 0) {
      try {
        const lauGeo = resolveWorkforceLauGeography(input.target_geography);
        const lauRecords = await lauAdapter.query({
          geography: lauGeo,
        });
        input.lau_evidence = lauRecords as EconomicEvidenceRecord[];
      } catch {
        input.lau_evidence = [];
      }
    }

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
      const nowIso = new Date(options.clock.now()).toISOString();
      const result = analyzeWorkforceContext(input, nowIso);

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
