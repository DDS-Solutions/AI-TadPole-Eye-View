import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  type Actor,
  GevEvents,
  type ProviderRegistry,
  ProviderRegistrySchema,
  SystemHealthResponseSchema,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { CapBudgetGovernor, PromptApprovalGate, SqliteAuditSink } from '@gev/governance';
import {
  AisAdapter,
  CctvAdapter,
  FirmsAdapter,
  GbfsAdapter,
  LaunchAdapter,
  OpenSkyAdapter,
  RadioAdapter,
  UsgsQuakeAdapter,
  WeatherAdapter,
  createConfiguredProviderRegistry,
} from '@gev/providers';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { WebSocketServer } from 'ws';
import { CostGovernor } from './middleware/costGovernor.js';
import { InMemoryRateLimiter, type OpsAuthOptions, createOpsAuth } from './middleware/opsAuth.js';
import { PRODUCT_VERSION } from './productVersion.js';
import { createAuditStreamRouter } from './routes/auditStream.js';
import { createCctvRouter } from './routes/cctv.js';
import {
  CollabRoomManager,
  createCollabRouter,
  isAllowedWebSocketOrigin,
} from './routes/collab.js';
import { createFirmsRouter } from './routes/firms.js';
import { createFlightsRouter } from './routes/flights.js';
import { createGbfsRouter } from './routes/gbfs.js';
import { createFeedHealthRouter } from './routes/health.js';
import { createLaunchRouter } from './routes/launches.js';
import { createOverpassRouter } from './routes/overpass.js';
import { createQuakesRouter } from './routes/quakes.js';
import { createRadioRouter } from './routes/radio.js';
import { createShipsRouter } from './routes/ships.js';
import { createVoiceRouter } from './routes/voice.js';
import { createWeatherRouter } from './routes/weather.js';
import { ServerTelemetryManager } from './telemetry/index.js';

export interface CreateAppOptions {
  opsAuth?: OpsAuthOptions;
  providerRegistry?: ProviderRegistry;
  clock?: SimClock;
  voiceApiKey?: string;
  resolveClientId?: (c: Context) => string;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();
  const clock = options.clock ?? new SystemClock();
  const telemetry = new ServerTelemetryManager({ clock });
  const auth = createOpsAuth(options.opsAuth);
  const opsAuth = auth.middleware();
  const rateLimiter = new InMemoryRateLimiter(clock);
  const resolveClientId =
    options.resolveClientId ??
    ((c: Context) => {
      try {
        return getConnInfo(c).remote.address ?? 'unknown-client';
      } catch {
        return 'unknown-client';
      }
    });
  const providerRegistry = ProviderRegistrySchema.parse(
    options.providerRegistry ?? createConfiguredProviderRegistry()
  );

  // Adapters
  const openSkyAdapter = new OpenSkyAdapter({ clock });
  const aisAdapter = new AisAdapter({ clock });
  const quakeAdapter = new UsgsQuakeAdapter({ clock });
  const firmsAdapter = new FirmsAdapter({ clock });
  const gbfsAdapter = new GbfsAdapter({ clock });
  const radioAdapter = new RadioAdapter({ clock });
  const cctvAdapter = new CctvAdapter({ clock });
  const launchAdapter = new LaunchAdapter({ clock });
  const weatherAdapter = new WeatherAdapter({ clock });

  // Governance, Cost Governor & Collab Manager
  const auditSink = new SqliteAuditSink({ clock });
  const budgetGovernor = new CapBudgetGovernor({ clock });
  const approvalGate = new PromptApprovalGate({ clock });
  const costGovernor = new CostGovernor({ clock, budgetGovernor });
  const collabRoomManager = new CollabRoomManager(clock);

  // Global Middleware
  app.use(
    '*',
    cors({
      origin: process.env.GEV_CORS_ORIGIN || 'http://localhost:5173',
      credentials: true,
    })
  );

  // Register the control-plane guard before every /ops/* route.
  app.use('/ops/*', opsAuth);

  // Health and provider status
  app.get('/api/health', async (c) => {
    const govState = budgetGovernor.state();
    telemetry.trackEvent('system.health_check');
    const hasDegradedImplementedProvider = providerRegistry.providers.some(
      (provider) => provider.implementation === 'implemented' && provider.health !== 'healthy'
    );
    return c.json(
      SystemHealthResponseSchema.parse({
        status: hasDegradedImplementedProvider ? 'degraded' : 'ok',
        version: PRODUCT_VERSION,
        seed_mode: providerRegistry.requested_mode === 'seed',
        timestamp: clock.now(),
        stasis_active: govState.stasis_active,
        budget_spent_usd: govState.spent_usd,
        budget_cap_usd: govState.cap_usd,
        budget_remaining_usd: Math.max(0, govState.cap_usd - govState.spent_usd),
        provider_registry: providerRegistry,
      })
    );
  });

  // Telemetry Metrics Endpoint (PLAN.md §7.1 & §10)
  app.get('/api/telemetry/metrics', async (c) => {
    return c.json(telemetry.getMetrics());
  });

  // Diagnostic Feed Health Endpoint
  app.route('/api/feeds', createFeedHealthRouter({ clock, budgetGovernor, providerRegistry }));

  // Telemetry Feed Routes with Cost Governor Middleware
  app.use('/api/flights/*', costGovernor.middleware('flights'));
  app.route('/api/flights', createFlightsRouter(openSkyAdapter));

  app.use('/api/ships/*', costGovernor.middleware('ships'));
  app.route('/api/ships', createShipsRouter(aisAdapter));

  app.use('/api/quakes/*', costGovernor.middleware('quakes'));
  app.route('/api/quakes', createQuakesRouter(quakeAdapter));

  app.use('/api/firms/*', costGovernor.middleware('firms'));
  app.route('/api/firms', createFirmsRouter(firmsAdapter));

  app.use('/api/gbfs/*', costGovernor.middleware('gbfs'));
  app.route('/api/gbfs', createGbfsRouter(gbfsAdapter));

  app.use('/api/radio/*', costGovernor.middleware('radio'));
  app.route('/api/radio', createRadioRouter(radioAdapter));

  app.use('/api/overpass/*', costGovernor.middleware('overpass'));
  app.route(
    '/api/overpass',
    createOverpassRouter({ seedMode: providerRegistry.requested_mode === 'seed', clock })
  );

  app.use('/api/cctv/*', costGovernor.middleware('cctv'));
  app.route('/api/cctv', createCctvRouter(cctvAdapter));

  app.use('/api/launches/*', costGovernor.middleware('launches'));
  app.route('/api/launches', createLaunchRouter({ adapter: launchAdapter }));

  app.use('/api/weather/*', costGovernor.middleware('weather'));
  app.route('/api/weather', createWeatherRouter({ adapter: weatherAdapter }));

  // Voice Ephemeral Token Provisioning
  app.route(
    '/api/voice',
    createVoiceRouter({
      auth,
      clock,
      apiKey: options.voiceApiKey,
      rateLimiter,
      resolveClientId,
    })
  );

  // T2 Collaborative Intent Rooms Route
  app.route(
    '/api/collab',
    createCollabRouter(collabRoomManager, { auth, rateLimiter, resolveClientId })
  );

  // M1 Observer Real-Time Audit SSE Stream
  app.route('/ops/audit', createAuditStreamRouter(auditSink, clock));

  // Governed Mutating Endpoint (Rule 1, Rule 2 & PLAN.md §6):
  // Strict order: intent → budget.check → approval → execute → outcome
  app.post('/ops/seed/reload', async (c) => {
    const startTime = clock.now();
    const taskRef = c.req.header('X-Task-Ref') || `task-${crypto.randomUUID().slice(0, 8)}`;
    const actor = (c.var as unknown as { opsActor: Actor }).opsActor;
    const intentId = crypto.randomUUID();
    const intentTs = new Date(startTime).toISOString();

    // 1. Audit Intent FIRST (Rule 1)
    auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: intentTs,
      actor,
      action: 'seed.reload',
      target: 'fixtures/flights-opensky.json',
      params: { timestamp: startTime },
      task_ref: taskRef,
    });

    // 2. Budget Governor Check (Rule 2)
    const spendVerdict = budgetGovernor.check({
      action: 'seed.reload',
      estimate: { currency: 'usd', min: 0.05, max: 0.05 },
    });

    if (!spendVerdict.allowed) {
      const durationMs = clock.now() - startTime;
      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(clock.now()).toISOString(),
        status: 'blocked',
        error: `STASIS active or budget exceeded: ${spendVerdict.message} (${spendVerdict.reason})`,
        duration_ms: durationMs,
      });

      return c.json(
        {
          status: 'blocked',
          intent_id: intentId,
          stasis_active: budgetGovernor.state().stasis_active,
          reason: spendVerdict.reason,
          message: spendVerdict.message,
        },
        429
      );
    }

    // 3. Approval Gate Request for Mutating Action
    const approvalDecision = await approvalGate.request({
      id: crypto.randomUUID(),
      ts: intentTs,
      intent_id: intentId,
      scopes: ['flags.write'],
      rationale: 'Reloading seed fixtures mutates in-memory telemetry state for active session',
      expires_at: new Date(startTime + 30000).toISOString(),
    });

    if (approvalDecision.decision !== 'approved') {
      const durationMs = clock.now() - startTime;
      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(clock.now()).toISOString(),
        status: 'blocked',
        error: `Action denied by approval gate (decision: ${approvalDecision.decision})`,
        duration_ms: durationMs,
      });

      return c.json(
        {
          status: 'denied',
          intent_id: intentId,
          decision: approvalDecision.decision,
        },
        403
      );
    }

    // 4. Deterministic Execution
    try {
      const batch = await openSkyAdapter.getFlights();
      const durationMs = clock.now() - startTime;

      // 5. Audit Outcome AFTER (Rule 1)
      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(clock.now()).toISOString(),
        status: 'ok',
        result: {
          reloaded: true,
          aircraft_count: batch.states.length,
          time: batch.time,
        },
        duration_ms: durationMs,
      });

      return c.json({
        status: 'ok',
        intent_id: intentId,
        result: {
          reloaded: true,
          aircraft_count: batch.states.length,
        },
      });
    } catch (err: unknown) {
      const durationMs = clock.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : 'Unknown reload failure';

      auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(clock.now()).toISOString(),
        status: 'error',
        error: errorMsg,
        duration_ms: durationMs,
      });

      return c.json({ status: 'error', intent_id: intentId, error: errorMsg }, 500);
    }
  });

  // Ops Audit Log Query
  app.get('/ops/audit', async (c) => {
    const taskRef = c.req.query('task_ref');
    const limitParam = c.req.query('limit');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 100;
    if (taskRef) {
      const entries = auditSink.tailByTaskRef(taskRef);
      return c.json({ entries });
    }
    const entries = auditSink.tail({ limit });
    return c.json({ entries });
  });

  // Ops Governor Status
  app.get('/ops/status', async (c) => {
    return c.json(budgetGovernor.state());
  });

  // Ops STASIS Resume (Rule 1: intent → action → outcome; human-only)
  app.post('/ops/resume', async (c) => {
    const identity = c.var as unknown as { opsActor: Actor; opsAuthenticated: boolean };
    const actor = identity.opsActor;
    if (identity.opsAuthenticated !== true || actor !== 'human') {
      return c.json(
        {
          error: 'STASIS resume requires an authenticated human operator',
          code: 'HUMAN_AUTH_REQUIRED',
        },
        403
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason ?? 'Human operator manual override via ops API';
    const state = budgetGovernor.state();

    if (!state.stasis_active) {
      return c.json({ status: 'ok', message: 'STASIS is not currently active' });
    }

    const startTime = clock.now();
    const intentId = crypto.randomUUID();

    // Rule 1: Audit intent BEFORE mutation
    auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(startTime).toISOString(),
      actor,
      action: 'governance.resume',
      target: 'stasis.lock',
      params: { reason },
      task_ref: 'ops-resume',
    });

    budgetGovernor.resume(actor);

    // Rule 1: Audit outcome AFTER mutation
    auditSink.outcome({
      kind: GevEvents.AuditOutcome,
      intent_id: intentId,
      ts: new Date(clock.now()).toISOString(),
      status: 'ok',
      result: { resumed: true, reason },
      duration_ms: clock.now() - startTime,
    });

    return c.json({ status: 'ok', message: 'STASIS resumed', reason });
  });

  return {
    app,
    auth,
    auditSink,
    budgetGovernor,
    approvalGate,
    costGovernor,
    rateLimiter,
    resolveClientId,
    collabRoomManager,
    telemetry,
    clock,
    providerRegistry,
    adapters: {
      openSky: openSkyAdapter,
      ais: aisAdapter,
      quake: quakeAdapter,
      firms: firmsAdapter,
      gbfs: gbfsAdapter,
      radio: radioAdapter,
      cctv: cctvAdapter,
    },
  };
}

export function attachWebSocketCollabServer(
  server: ReturnType<typeof serve>,
  collabRoomManager: CollabRoomManager,
  rateLimiter: InMemoryRateLimiter,
  allowedOrigin = process.env.GEV_CORS_ORIGIN || 'http://localhost:5173'
) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const origin = req.headers.origin;
    if (!isAllowedWebSocketOrigin(origin, allowedOrigin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathMatch = /^\/api\/collab\/room\/([^/]+)$/.exec(url.pathname);
    if (pathMatch) {
      const clientId = req.socket.remoteAddress ?? 'unknown-client';
      const rateDecision = rateLimiter.consume('collab-ws-upgrade', clientId, 20);
      if (!rateDecision.allowed) {
        socket.write(
          `HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${rateDecision.retryAfterSeconds}\r\n\r\n`
        );
        socket.destroy();
        return;
      }
      const token = url.searchParams.get('token');
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      let requestedRoomId: string;
      try {
        requestedRoomId = decodeURIComponent(pathMatch[1] ?? '');
      } catch {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
      const verified = await collabRoomManager.verifyRoomTokenForRoom(token, requestedRoomId);
      if (!verified) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        collabRoomManager.handleWebSocketPeer(ws, verified);
      });
    } else {
      socket.destroy();
    }
  });

  return wss;
}
if (process.env.NODE_ENV !== 'test') {
  const { app, collabRoomManager, rateLimiter } = createApp();
  const port = Number(process.env.PORT) || 3000;
  const hostname = process.env.GEV_HOST || '127.0.0.1';
  const server = serve({
    fetch: app.fetch,
    port,
    hostname,
  });

  attachWebSocketCollabServer(server, collabRoomManager, rateLimiter);
}
