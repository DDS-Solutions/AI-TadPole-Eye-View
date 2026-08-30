import { CableCatalogResponseSchema } from '@gev/contracts';
import { type CableAdapter, CableProviderDisabledError } from '@gev/providers';
import { Hono } from 'hono';

export function createCablesRouter(adapter: CableAdapter): Hono {
  const router = new Hono();

  router.get('/', async (context) => {
    try {
      return context.json(CableCatalogResponseSchema.parse(await adapter.getCatalog()));
    } catch (error) {
      if (error instanceof CableProviderDisabledError) {
        return context.json({ error: error.message, code: 'PROVIDER_DISABLED' }, 503);
      }
      return context.json(
        { error: 'Cable catalog failed contract validation', code: 'PROVIDER_BOUNDARY_FAILED' },
        502
      );
    }
  });

  return router;
}
