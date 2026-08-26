import { type BoundingBox, BoundingBox as BoundingBoxSchema } from '@gev/contracts';
import type { UsgsQuakeAdapter } from '@gev/providers';
import { Hono } from 'hono';

export function createQuakesRouter(adapter: UsgsQuakeAdapter) {
  const router = new Hono();

  router.get('/', async (c) => {
    let bbox: BoundingBox | undefined;
    const minMagParam = c.req.query('min_mag');
    const minMag = minMagParam ? Number.parseFloat(minMagParam) : 2.5;

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
      const collection = await adapter.getQuakes(minMag, bbox);
      return c.json(collection);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown USGS provider error';
      return c.json({ error: message, source: 'usgs' }, 502);
    }
  });

  return router;
}
