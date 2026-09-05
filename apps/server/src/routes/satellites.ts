import { SatellitePropagationBatchSchema } from '@gev/contracts';
import {
  SatellitePropagationError,
  type SatellitePropagator,
} from '@gev/core/satellite-propagation';
import {
  type SatelliteAdapter,
  SatelliteLiveAccessLockedError,
  SatelliteProviderDisabledError,
} from '@gev/providers';
import { Hono } from 'hono';

export function createSatellitesRouter(
  adapter: SatelliteAdapter,
  propagator: SatellitePropagator
): Hono {
  const router = new Hono();

  router.get('/', async (context) => {
    try {
      const catalog = await adapter.getCatalog();
      return context.json(SatellitePropagationBatchSchema.parse(propagator.propagate(catalog)));
    } catch (error) {
      if (error instanceof SatelliteProviderDisabledError) {
        return context.json({ error: error.message, code: 'PROVIDER_DISABLED' }, 503);
      }
      if (error instanceof SatelliteLiveAccessLockedError) {
        return context.json({ error: error.message, code: 'TERMS_APPROVAL_REQUIRED' }, 423);
      }
      if (error instanceof SatellitePropagationError) {
        return context.json(
          {
            error: 'Satellite elements could not be propagated safely',
            code: 'PROPAGATION_FAILED',
          },
          502
        );
      }
      return context.json(
        { error: 'Satellite source failed contract validation', code: 'PROVIDER_BOUNDARY_FAILED' },
        502
      );
    }
  });

  return router;
}
