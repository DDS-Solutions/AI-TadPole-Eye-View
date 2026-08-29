import { LaunchCatalog } from '@gev/contracts';
import { LaunchAdapter } from '@gev/providers';
import { Hono } from 'hono';

export interface LaunchRouteOptions {
  adapter?: LaunchAdapter;
}

export function createLaunchRouter(options: LaunchRouteOptions = {}) {
  const router = new Hono();
  const adapter = options.adapter ?? new LaunchAdapter();

  router.get('/', async (c) => {
    try {
      const catalog = LaunchCatalog.parse(await adapter.getLaunches());
      return c.json(catalog);
    } catch (err: unknown) {
      return c.json(
        {
          error: 'Failed to fetch space launch catalog',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
        500
      );
    }
  });

  return router;
}
