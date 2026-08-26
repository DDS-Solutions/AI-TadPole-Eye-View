import { type BoundingBox, BoundingBox as BoundingBoxSchema } from '@gev/contracts';
import type { GbfsAdapter } from '@gev/providers';
import { Hono } from 'hono';

export function createGbfsRouter(adapter: GbfsAdapter) {
  const router = new Hono();

  router.get('/', async (c) => {
    let bbox: BoundingBox | undefined;
    const lamin = c.req.query('lamin');
    const lamax = c.req.query('lamax');
    const lomin = c.req.query('lomin');
    const lomax = c.req.query('lomax');

    if (lamin && lamax && lomin && lomax) {
      const parsed = BoundingBoxSchema.safeParse({
        min_lat: Number.parseFloat(lamin),
        max_lat: Number.parseFloat(lamax),
        min_lon: Number.parseFloat(lomin),
        max_lon: Number.parseFloat(lomax),
      });

      if (parsed.success) {
        bbox = parsed.data;
      }
    }

    try {
      const batch = await adapter.getStations(bbox);
      return c.json(batch);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown GBFS error';
      return c.json({ error: message, source: 'gbfs' }, 502);
    }
  });

  return router;
}
