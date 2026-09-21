import crypto from 'node:crypto';
import {
  type Actor,
  CompetitionAnalysisInputSchema,
  type EconomicEvidenceRecord,
  GevEvents,
  LocationComparisonInputSchema,
  MarketAnalysisInputSchema,
  TenantIdSchema,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { analyzeCompetition, analyzeMarketContext, compareLocations } from '@gev/economic';
import type { CapBudgetGovernor, SqliteAuditSink, SqliteBudgetLedger } from '@gev/governance';
import { EconomicFixtureAdapter } from '@gev/providers';
import { type Context, Hono } from 'hono';
import type { InMemoryRateLimiter, OpsAuthAdapter } from '../middleware/opsAuth.js';

export const DEFAULT_MARKET_ANALYSIS_RATE_LIMIT = 60;

export interface MarketAnalysisRouterOptions {
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

export function createMarketAnalysisRouter(options: MarketAnalysisRouterOptions): Hono {
  const router = new Hono();
  const adapter = options.fixtureAdapter ?? new EconomicFixtureAdapter({ clock: options.clock });
  const rateLimit = options.requestsPerMinute ?? DEFAULT_MARKET_ANALYSIS_RATE_LIMIT;

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
            error: 'Unauthorized: Authenticated tenant required for market analysis',
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
            error: 'STASIS: economic market analysis reads are suspended',
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
              error: `STASIS: economic market analysis is suspended for tenant '${tenantId}'`,
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
            error: 'Rate limit exceeded for economic market analysis',
            code: 'RATE_LIMITED',
          },
          429
        ),
      };
    }

    const taskRef = context.req.header('X-Task-Ref') || 'economic-market-analysis-http';

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

  // 1. Market Context Analysis
  const handleMarketAnalysis = async (context: Context) => {
    const gov = await validateGovernance(context, 'economic-market-analysis');
    if (!gov.allowed) return gov.response;

    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON request payload', code: 'INVALID_INPUT' }, 400);
    }

    const parsed = MarketAnalysisInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return context.json(
        {
          error: 'Invalid market analysis input parameters',
          code: 'INVALID_INPUT',
          details: parsed.error.issues,
        },
        400
      );
    }

    const input = { ...parsed.data, tenant_id: gov.tenantId };
    const intentId = crypto.randomUUID();

    // Auto-populate evidence records from fixture adapter if omitted
    if (input.acs_evidence.length === 0) {
      const acsRecords = adapter.getEvidenceRecords({ geography: input.target_geography });
      input.acs_evidence = acsRecords.filter(
        (r) => r.source_id === 'census-acs'
      ) as EconomicEvidenceRecord[];
    }
    if (input.cbp_evidence.length === 0) {
      const cbpRecords = adapter.getEvidenceRecords({
        geography: input.target_geography,
        naicsCode: input.naics_code,
      });
      input.cbp_evidence = cbpRecords.filter(
        (r) => r.source_id === 'census-cbp-zbp'
      ) as EconomicEvidenceRecord[];
    }
    if (!input.osm_evidence || input.osm_evidence.length === 0) {
      const osmRecords = adapter.getEvidenceRecords({ geography: input.target_geography });
      input.osm_evidence = osmRecords.filter(
        (r) => r.source_id === 'osm-commercial'
      ) as EconomicEvidenceRecord[];
    }

    if (!input.osm_footprint) {
      input.osm_footprint = {
        total_features: 1540,
        category_counts: {
          food_and_beverage: 650,
          retail: 420,
          services: 230,
          office: 120,
          craft_industrial: 40,
          healthcare: 50,
          hospitality: 30,
          other_commercial: 0,
        },
        density_per_km2: 24.5,
        area_km2: 62.85,
        top_amenities: [],
      };
    }

    options.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(gov.startedAt).toISOString(),
      actor: gov.actor,
      action: 'economic.market.analyze',
      target: `tenant:${gov.tenantId}`,
      params: { geography: input.target_geography, naics_code: input.naics_code },
      task_ref: gov.taskRef,
    });

    try {
      const nowIso = new Date(options.clock.now()).toISOString();
      const result = analyzeMarketContext(input, nowIso);
      logOutcome(intentId, gov.startedAt, 'ok', {
        analysis_id: result.analysis_id,
        total_population: result.demographics.total_population.status,
        total_establishments: result.business_activity.total_establishments.status,
        has_disagreements: result.disagreement_state.has_disagreements,
      });
      context.header('Cache-Control', 'no-store');
      context.header('Vary', 'Authorization, X-GEV-Tenant');
      return context.json(result, 200);
    } catch (err) {
      logOutcome(
        intentId,
        gov.startedAt,
        'error',
        err instanceof Error ? err.message : 'Market analysis calculation failed'
      );
      return context.json(
        { error: 'Market analysis calculation failed', code: 'MARKET_ANALYSIS_FAILED' },
        500
      );
    }
  };

  // 2. Competition Analysis
  const handleCompetitionAnalysis = async (context: Context) => {
    const gov = await validateGovernance(context, 'economic-competition-analysis');
    if (!gov.allowed) return gov.response;

    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON request payload', code: 'INVALID_INPUT' }, 400);
    }

    const parsed = CompetitionAnalysisInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return context.json(
        {
          error: 'Invalid competition analysis input parameters',
          code: 'INVALID_INPUT',
          details: parsed.error.issues,
        },
        400
      );
    }

    const input = { ...parsed.data, tenant_id: gov.tenantId };
    const intentId = crypto.randomUUID();

    if (input.cbp_evidence.length === 0) {
      const cbpRecords = adapter.getEvidenceRecords({
        geography: input.target_geography,
        naicsCode: input.naics_code,
      });
      input.cbp_evidence = cbpRecords.filter(
        (r) => r.source_id === 'census-cbp-zbp'
      ) as EconomicEvidenceRecord[];
    }

    options.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(gov.startedAt).toISOString(),
      actor: gov.actor,
      action: 'economic.competition.analyze',
      target: `tenant:${gov.tenantId}`,
      params: {
        geography: input.target_geography,
        naics_code: input.naics_code,
        industry_title: input.industry_title,
      },
      task_ref: gov.taskRef,
    });

    try {
      const nowIso = new Date(options.clock.now()).toISOString();
      const result = analyzeCompetition(input, nowIso);
      logOutcome(intentId, gov.startedAt, 'ok', {
        analysis_id: result.analysis_id,
        hhi: result.concentration.hhi,
        tier: result.concentration.tier,
        has_disagreements: result.disagreement_state.has_disagreements,
      });
      context.header('Cache-Control', 'no-store');
      context.header('Vary', 'Authorization, X-GEV-Tenant');
      return context.json(result, 200);
    } catch (err) {
      logOutcome(
        intentId,
        gov.startedAt,
        'error',
        err instanceof Error ? err.message : 'Competition analysis calculation failed'
      );
      return context.json(
        { error: 'Competition analysis calculation failed', code: 'COMPETITION_ANALYSIS_FAILED' },
        500
      );
    }
  };

  // 3. Location Comparison
  const handleLocationComparison = async (context: Context) => {
    const gov = await validateGovernance(context, 'economic-location-comparison');
    if (!gov.allowed) return gov.response;

    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      return context.json({ error: 'Invalid JSON request payload', code: 'INVALID_INPUT' }, 400);
    }

    const parsed = LocationComparisonInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return context.json(
        {
          error: 'Invalid location comparison input parameters',
          code: 'INVALID_INPUT',
          details: parsed.error.issues,
        },
        400
      );
    }

    const input = {
      ...parsed.data,
      tenant_id: gov.tenantId,
      locations: parsed.data.locations.map((loc) => {
        let acs = loc.acs_evidence;
        let cbp = loc.cbp_evidence;
        if (acs.length === 0) {
          acs = adapter
            .getEvidenceRecords({ geography: loc.geography })
            .filter((r) => r.source_id === 'census-acs') as EconomicEvidenceRecord[];
        }
        if (cbp.length === 0) {
          cbp = adapter
            .getEvidenceRecords({ geography: loc.geography, naicsCode: parsed.data.naics_code })
            .filter((r) => r.source_id === 'census-cbp-zbp') as EconomicEvidenceRecord[];
        }
        return { ...loc, acs_evidence: acs, cbp_evidence: cbp };
      }),
    };

    const intentId = crypto.randomUUID();

    options.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(gov.startedAt).toISOString(),
      actor: gov.actor,
      action: 'economic.location.compare',
      target: `tenant:${gov.tenantId}`,
      params: { location_count: input.locations.length, benchmark: input.benchmark_location_key },
      task_ref: gov.taskRef,
    });

    try {
      const nowIso = new Date(options.clock.now()).toISOString();
      const result = compareLocations(input, nowIso);
      logOutcome(intentId, gov.startedAt, 'ok', {
        comparison_id: result.comparison_id,
        location_count: result.locations.length,
        metric_rows_count: result.metrics.length,
      });
      context.header('Cache-Control', 'no-store');
      context.header('Vary', 'Authorization, X-GEV-Tenant');
      return context.json(result, 200);
    } catch (err) {
      logOutcome(
        intentId,
        gov.startedAt,
        'error',
        err instanceof Error ? err.message : 'Location comparison calculation failed'
      );
      return context.json(
        { error: 'Location comparison calculation failed', code: 'LOCATION_COMPARISON_FAILED' },
        500
      );
    }
  };

  router.post('/market-analysis', handleMarketAnalysis);
  router.post('/market/analyze', handleMarketAnalysis);

  router.post('/competition-analysis', handleCompetitionAnalysis);
  router.post('/competition/analyze', handleCompetitionAnalysis);

  router.post('/location-comparison', handleLocationComparison);
  router.post('/location/compare', handleLocationComparison);

  return router;
}
