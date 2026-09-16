import { ProviderRegistrySchema, SystemHealthResponseSchema } from '@gev/contracts';
import { GovernedToolExecutor, SystemClock } from '@gev/core';
import { SatellitePropagator } from '@gev/core/satellite-propagation';
import { createGovernanceRuntimeContext } from '@gev/governance';
import {
  AisAdapter,
  CableAdapter,
  CablePackLoader,
  CctvAdapter,
  FirmsAdapter,
  GbfsAdapter,
  LaunchAdapter,
  OpenSkyAdapter,
  RadioAdapter,
  SatelliteAdapter,
  UsgsQuakeAdapter,
  WeatherAdapter,
  activateProviderDownloadPack,
  createConfiguredProviderRegistry,
  withDisabledProviders,
  withProviderHealth,
  withUnavailableProviders,
} from '@gev/providers';
import { getConnInfo } from '@hono/node-server/conninfo';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import type { CreateAppOptions } from './appOptions.js';
import { mountMcpHttpRuntime } from './mcpRuntime.js';
import { CostGovernor, DEFAULT_PROVIDER_TIERS } from './middleware/costGovernor.js';
import {
  InMemoryRateLimiter,
  createOpsAuth,
  createRateLimitMiddleware,
  mountOpsAuthorization,
} from './middleware/opsAuth.js';
import { PRODUCT_VERSION } from './productVersion.js';
import { createAuditIntegrityRouter } from './routes/auditIntegrity.js';
import { createAuditStreamRouter } from './routes/auditStream.js';
import { createBudgetReconciliationRouter } from './routes/budgetReconciliation.js';
import { createCablePackActivationRouter } from './routes/cablePackActivation.js';
import { createCablesRouter } from './routes/cables.js';
import { createCctvRouter } from './routes/cctv.js';
import { CollabRoomManager, createCollabRouter } from './routes/collab.js';
import { createFirmsRouter } from './routes/firms.js';
import { createFlightsRouter } from './routes/flights.js';
import { createGbfsRouter } from './routes/gbfs.js';
import { createFeedHealthRouter } from './routes/health.js';
import { createLaunchRouter } from './routes/launches.js';
import { createLayerAccessRouter } from './routes/layerAccess.js';
import { createOperationalAwarenessRouter } from './routes/operationalAwareness.js';
import { createOverpassRouter } from './routes/overpass.js';
import { createQuakesRouter } from './routes/quakes.js';
import { createRadioRouter } from './routes/radio.js';
import { createSatellitesRouter } from './routes/satellites.js';
import { createOpsResumeRouter } from './routes/opsResume.js';
import { createSeedReloadRouter } from './routes/seedReload.js';
import { createShipsRouter } from './routes/ships.js';
import { createVoiceRouter } from './routes/voice.js';
import { createWeatherRouter } from './routes/weather.js';
import { startStandaloneServer } from './serverStartup.js';
import { ServerTelemetryManager } from './telemetry/index.js';

export { attachWebSocketCollabServer } from './websocketCollab.js';
export type { CreateAppOptions } from './appOptions.js';

export const SATELLITE_REQUESTS_PER_MINUTE = 60;

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();
  if (
    options.clock &&
    options.governanceContext &&
    options.clock !== options.governanceContext.clock
  ) {
    throw new Error('Server clock must be the shared governance runtime clock');
  }
  const clock = options.governanceContext?.clock ?? options.clock ?? new SystemClock();
  const governanceContext =
    options.governanceContext ??
    createGovernanceRuntimeContext({ clock, dbPath: options.governanceDbPath });
  const telemetry = new ServerTelemetryManager({ clock });
  const auth = createOpsAuth({
    ...options.opsAuth,
    bearerVerifier: options.identityBearerVerifier,
    clock,
  });
  const opsAuth = auth.middleware({
    allowedRoles: ['operator', 'tenant_admin', 'platform_admin'],
  });
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
  const cablesEnabled = options.cablesEnabled ?? process.env.GEV_CABLES_ENABLED !== '0';
  const satellitesEnabled = options.satellitesEnabled ?? process.env.GEV_SATELLITES_ENABLED !== '0';
  const satelliteLiveAccessEnabled =
    options.satelliteLiveAccessEnabled ?? process.env.GEV_SATELLITES_LIVE_ACCESS === '1';
  const celestrakTermsApproved =
    options.celestrakTermsApproved ?? process.env.GEV_CELESTRAK_TERMS_APPROVED === '1';
  const configuredProviderRegistry = ProviderRegistrySchema.parse(
    options.providerRegistry ?? createConfiguredProviderRegistry()
  );
  let providerRegistry = cablesEnabled
    ? configuredProviderRegistry
    : withDisabledProviders(configuredProviderRegistry, ['submarine-cables']);
  if (!satellitesEnabled) {
    providerRegistry = withDisabledProviders(providerRegistry, ['celestrak']);
  } else if (
    providerRegistry.requested_mode === 'live' &&
    (!satelliteLiveAccessEnabled || !celestrakTermsApproved)
  ) {
    providerRegistry = withUnavailableProviders(providerRegistry, ['celestrak']);
  }

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
  const cableAdapter = new CableAdapter({ clock, enabled: cablesEnabled });
  const cablePackLoader = new CablePackLoader({
    clock,
    enabled: cablesEnabled,
    manifests: options.cablePackManifests,
    fetcher: options.cablePackFetcher,
  });
  const satelliteAdapter = new SatelliteAdapter({
    clock,
    seedMode: providerRegistry.requested_mode !== 'live',
    liveMode: providerRegistry.requested_mode === 'live',
    enabled: satellitesEnabled,
    liveAccessEnabled: satelliteLiveAccessEnabled,
    termsApproved: celestrakTermsApproved,
    groups: options.satelliteGroups,
    fetcher: options.satelliteFetcher,
    onHealthChange: (health) => {
      providerRegistry = withProviderHealth(providerRegistry, 'celestrak', health);
    },
  });
  const satellitePropagator = new SatellitePropagator(clock);

  // One shared governance runtime is used by every server route and middleware.
  const { auditSink, budgetGovernor, budgetLedger, approvalGate, tenantLayerAccessStore } =
    governanceContext;
  const costGovernor = new CostGovernor({
    clock,
    budgetLedger,
    rateLimiter,
    tenantRateLimits: options.tenantRateLimits,
    isProviderEnabled: options.isProviderEnabled,
    auth,
    ...(providerRegistry.requested_mode === 'seed'
      ? {
          tiers: Object.fromEntries(
            Object.entries(DEFAULT_PROVIDER_TIERS).map(([name, tier]) => [
              name,
              { ...tier, costPerFetchUsd: 0 },
            ])
          ),
        }
      : {}),
    ...options.costGovernorOptions,
  });
  const collabRoomManager = new CollabRoomManager(clock);
  const cableActivationErrors = new Map<string, string>();
  const cablePackExecutor = new GovernedToolExecutor({
    auditSink,
    approvalGate,
    budgetGovernor,
    budgetLedger,
    clock,
    allowedTools: ['set_flag'],
  });
  cablePackExecutor.register('set_flag', async (input) => {
    const prefix = 'cables.download-pack.';
    if (input.flag.startsWith(prefix)) {
      if (!input.enabled) {
        return { flag: input.flag, enabled: input.enabled, updated: false };
      }
      const packId = input.flag.slice(prefix.length);
      try {
        const response = await cablePackLoader.loadPack(packId);
        const nextRegistry = activateProviderDownloadPack(providerRegistry, 'submarine-cables');
        cableAdapter.activatePack(packId, response);
        providerRegistry = nextRegistry;
        costGovernor.invalidate('cables');
        cableActivationErrors.delete(packId);
        return { flag: input.flag, enabled: true, updated: true };
      } catch {
        cableActivationErrors.set(
          packId,
          'Configured cable pack is unavailable or failed integrity and contract validation'
        );
        return { flag: input.flag, enabled: true, updated: false };
      }
    }
    if (input.flag.endsWith('.enabled')) {
      const providerName = input.flag.replace(/\.enabled$/, '');
      costGovernor.invalidate(providerName);
      return { flag: input.flag, enabled: input.enabled, updated: true };
    }
    return { flag: input.flag, enabled: input.enabled, updated: false };
  });

  const mcpHttp = mountMcpHttpRuntime(
    app,
    {
      ...options,
      mcpHttpBearerVerifier: options.mcpHttpBearerVerifier ?? options.identityBearerVerifier,
    },
    {
      clock,
      governanceContext,
      openSkyAdapter,
      providerRegistry,
    }
  );

  app.use(
    '*',
    cors({
      origin: process.env.GEV_CORS_ORIGIN || 'http://localhost:5173',
      credentials: true,
    })
  );

  mountOpsAuthorization(app, auth);

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
        governance_authority: governanceContext.authority(),
        provider_registry: providerRegistry,
      })
    );
  });

  app.use('/api/telemetry/*', opsAuth);
  app.get('/api/telemetry/metrics', async (c) => {
    return c.json(telemetry.getMetrics());
  });

  const operationalAwarenessRouter = createOperationalAwarenessRouter({
    clock,
    auth,
    costGovernor,
    rateLimiter,
    resolveClientId,
    seedMode: providerRegistry.requested_mode === 'seed',
    stasisActive: () => budgetGovernor.state().stasis_active,
    onHealthChange: (providerId, health) => {
      providerRegistry = withProviderHealth(providerRegistry, providerId, health);
    },
  });
  app.route('/api/operational', operationalAwarenessRouter);

  app.route(
    '/api/feeds',
    createFeedHealthRouter({
      clock,
      budgetGovernor,
      providerRegistry,
      getProviderRegistry: () => providerRegistry,
    })
  );

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
  app.use('/api/cables/*', costGovernor.middleware('cables'));
  app.route('/api/cables', createCablesRouter(cableAdapter));

  // Source elements are cached inside the adapter; positions are re-propagated at SimClock time.
  // Request limiting therefore stays separate from the response-caching cost governor.
  const satelliteRateLimit =
    Number(process.env.GEV_SATELLITE_RATE_LIMIT) || SATELLITE_REQUESTS_PER_MINUTE;
  app.use(
    '/api/satellites/*',
    createRateLimitMiddleware(rateLimiter, {
      bucket: 'satellites-read',
      limit: satelliteRateLimit,
      resolveClientId,
    })
  );
  app.route('/api/satellites', createSatellitesRouter(satelliteAdapter, satellitePropagator));

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

  app.route(
    '/api/collab',
    createCollabRouter(collabRoomManager, { auth, rateLimiter, resolveClientId })
  );

  app.route('/ops/audit', createAuditIntegrityRouter(auditSink));
  app.route('/ops/audit', createAuditStreamRouter(auditSink, clock));
  app.route(
    '/ops/layer-access',
    createLayerAccessRouter({
      clock,
      auditSink,
      budgetGovernor,
      budgetLedger,
      tenantLayerAccessStore: options.tenantLayerAccessStore ?? tenantLayerAccessStore,
      credentialValidator: options.layerAccessCredentialValidator,
      getProviderRegistry: () => providerRegistry,
      ...(options.layerAccessAuthorizedLocalState
        ? { getAuthorizedLocalState: () => options.layerAccessAuthorizedLocalState ?? [] }
        : {}),
    })
  );
  app.route('/ops/budget', createBudgetReconciliationRouter({ clock, budgetLedger }));
  app.route(
    '/ops/cables',
    createCablePackActivationRouter({
      executor: cablePackExecutor,
      adapter: cableAdapter,
      readActivationError: (packId) => cableActivationErrors.get(packId),
    })
  );

  app.route(
    '/ops/seed',
    createSeedReloadRouter({ clock, budgetLedger, approvalGate, openSkyAdapter })
  );

  app.get('/ops/audit', async (c) => {
    const taskRef = c.req.query('task_ref');
    const limitParam = c.req.query('limit');
    const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : 100;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 1000) : 100;
    if (taskRef) {
      const entries = auditSink.tailByTaskRef(taskRef, limit);
      return c.json({ entries });
    }
    const entries = auditSink.tail({ limit });
    return c.json({ entries });
  });

  app.route('/ops', createOpsResumeRouter({ clock, auditSink, budgetGovernor }));

  return {
    app,
    auth,
    auditSink,
    budgetGovernor,
    budgetLedger,
    approvalGate,
    costGovernor,
    rateLimiter,
    resolveClientId,
    collabRoomManager,
    telemetry,
    clock,
    get providerRegistry() {
      return providerRegistry;
    },
    governanceContext,
    mcpHttp,
    adapters: {
      openSky: openSkyAdapter,
      ais: aisAdapter,
      quake: quakeAdapter,
      firms: firmsAdapter,
      gbfs: gbfsAdapter,
      radio: radioAdapter,
      cctv: cctvAdapter,
      cables: cableAdapter,
      satellites: satelliteAdapter,
    },
  };
}

if (process.env.NODE_ENV !== 'test') startStandaloneServer(createApp);
