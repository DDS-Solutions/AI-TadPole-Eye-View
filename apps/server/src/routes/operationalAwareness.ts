import {
  AviationWeatherResponseSchema,
  NwsAlertCollectionSchema,
  type OperationalAoi,
  OperationalAoiSchema,
  type ProviderHealth,
  SolarContextResponseSchema,
} from '@gev/contracts';
import type { SimClock } from '@gev/core';
import {
  AviationWeatherAdapter,
  NwsAlertsAdapter,
  OperationalSourceError,
  SolarContextAdapter,
} from '@gev/providers';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import type { CostGovernor } from '../middleware/costGovernor.js';
import {
  type InMemoryRateLimiter,
  type OpsAuthAdapter,
  createRateLimitMiddleware,
} from '../middleware/opsAuth.js';

export const DEFAULT_OPERATIONAL_AOI: OperationalAoi = {
  min_lat: 24,
  max_lat: 50,
  min_lon: -125,
  max_lon: -66,
};

export interface OperationalAwarenessRouterOptions {
  clock: SimClock;
  auth: OpsAuthAdapter;
  costGovernor: CostGovernor;
  rateLimiter: InMemoryRateLimiter;
  resolveClientId: (context: Context) => string;
  stasisActive: () => boolean;
  seedMode: boolean;
  solarAdapter?: SolarContextAdapter;
  nwsAdapter?: NwsAlertsAdapter;
  aviationAdapter?: AviationWeatherAdapter;
  onHealthChange?: (providerId: string, health: ProviderHealth) => void;
}

function parseAoi(context: Context): OperationalAoi | Response {
  const keys = ['min_lat', 'max_lat', 'min_lon', 'max_lon'] as const;
  const values = keys.map((key) => context.req.query(key));
  if (values.every((value) => value === undefined)) return DEFAULT_OPERATIONAL_AOI;
  if (values.some((value) => value === undefined)) {
    return context.json({ error: 'All four AOI bounds are required', code: 'INVALID_AOI' }, 400);
  }
  const parsed = OperationalAoiSchema.safeParse(
    Object.fromEntries(keys.map((key, index) => [key, Number(values[index])]))
  );
  return parsed.success
    ? parsed.data
    : context.json({ error: 'AOI bounds are invalid or exceed limits', code: 'INVALID_AOI' }, 400);
}

function handleError(context: Context, error: unknown): Response {
  if (error instanceof OperationalSourceError) {
    return context.json({ error: error.message, code: error.code }, error.status);
  }
  return context.json(
    { error: 'Operational-awareness provider is unavailable', code: 'SOURCE_UNAVAILABLE' },
    503
  );
}

function stasisGuard(options: OperationalAwarenessRouterOptions): MiddlewareHandler {
  return async (context, next) => {
    if (options.stasisActive()) {
      return context.json(
        { error: 'STASIS: operational-awareness reads are suspended', code: 'STASIS_ACTIVE' },
        423
      );
    }
    return next();
  };
}

export function createOperationalAwarenessRouter(options: OperationalAwarenessRouterOptions) {
  const router = new Hono();
  const solar =
    options.solarAdapter ??
    new SolarContextAdapter({ clock: options.clock, seedMode: options.seedMode });
  const nws =
    options.nwsAdapter ??
    new NwsAlertsAdapter({ clock: options.clock, seedMode: options.seedMode });
  const aviation =
    options.aviationAdapter ??
    new AviationWeatherAdapter({ clock: options.clock, seedMode: options.seedMode });

  router.use('*', options.auth.middleware());
  router.use('*', stasisGuard(options));
  router.use('/solar', options.costGovernor.middleware('solar-context'));
  router.use('/alerts', options.costGovernor.middleware('nws-alerts'));
  router.use(
    '/alerts',
    createRateLimitMiddleware(options.rateLimiter, {
      bucket: 'nws-alerts-upstream',
      limit: 2,
      resolveClientId: options.resolveClientId,
    })
  );
  router.use('/aviation', options.costGovernor.middleware('awc-weather'));
  router.use(
    '/aviation',
    createRateLimitMiddleware(options.rateLimiter, {
      bucket: 'awc-weather-upstream',
      limit: 1,
      resolveClientId: options.resolveClientId,
    })
  );

  router.get('/solar', (context) => {
    try {
      const response = SolarContextResponseSchema.parse(solar.getSolarContext());
      options.onHealthChange?.('gev-solar-context', 'healthy');
      return context.json(response);
    } catch (error) {
      options.onHealthChange?.('gev-solar-context', 'unavailable');
      return handleError(context, error);
    }
  });

  router.get('/alerts', async (context) => {
    const aoi = parseAoi(context);
    if (aoi instanceof Response) return aoi;
    try {
      const response = NwsAlertCollectionSchema.parse(await nws.getAlerts(aoi));
      options.onHealthChange?.(
        'noaa-nws-alerts',
        response.provenance.freshness.status === 'fresh' ? 'healthy' : 'degraded'
      );
      return context.json(response);
    } catch (error) {
      options.onHealthChange?.(
        'noaa-nws-alerts',
        error instanceof OperationalSourceError && error.code === 'SOURCE_STALE'
          ? 'unavailable'
          : 'degraded'
      );
      return handleError(context, error);
    }
  });

  router.get('/aviation', async (context) => {
    const aoi = parseAoi(context);
    if (aoi instanceof Response) return aoi;
    try {
      const response = AviationWeatherResponseSchema.parse(await aviation.getWeather(aoi));
      const freshness = [
        response.metars.provenance.freshness.status,
        response.tafs.provenance.freshness.status,
        response.sigmets.provenance.freshness.status,
      ];
      options.onHealthChange?.(
        'noaa-aviation-weather-center',
        freshness.every((status) => status === 'fresh') ? 'healthy' : 'degraded'
      );
      return context.json(response);
    } catch (error) {
      options.onHealthChange?.('noaa-aviation-weather-center', 'degraded');
      return handleError(context, error);
    }
  });

  return router;
}
