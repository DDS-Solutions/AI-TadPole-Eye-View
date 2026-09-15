import { type BoundingBox, BoundingBox as BoundingBoxSchema, FlightBatch } from '@gev/contracts';
import type { OpenSkyAdapter } from '@gev/providers';
import { Hono } from 'hono';

export function createFlightsRouter(adapter: OpenSkyAdapter) {
  const router = new Hono();

  router.get('/', async (c) => {
    let bbox: BoundingBox | undefined;
    const lamin = c.req.query('lamin');
    const lamax = c.req.query('lamax');
    const lomin = c.req.query('lomin');
    const lomax = c.req.query('lomax');

    const hasAnyBbox =
      lamin !== undefined || lamax !== undefined || lomin !== undefined || lomax !== undefined;
    if (hasAnyBbox) {
      if (!lamin || !lamax || !lomin || !lomax) {
        return c.json(
          {
            error: 'All four bounding box parameters (lamin, lamax, lomin, lomax) are required',
            code: 'INVALID_BBOX',
          },
          400
        );
      }
      const min_lat = Number.parseFloat(lamin);
      const max_lat = Number.parseFloat(lamax);
      const min_lon = Number.parseFloat(lomin);
      const max_lon = Number.parseFloat(lomax);

      if (
        Number.isNaN(min_lat) ||
        Number.isNaN(max_lat) ||
        Number.isNaN(min_lon) ||
        Number.isNaN(max_lon)
      ) {
        return c.json(
          {
            error: 'Bounding box parameters must be valid numbers',
            code: 'INVALID_BBOX',
          },
          400
        );
      }

      const parsed = BoundingBoxSchema.safeParse({ min_lat, max_lat, min_lon, max_lon });
      if (!parsed.success) {
        return c.json(
          {
            error: 'Bounding box coordinates are invalid or out of range',
            code: 'INVALID_BBOX',
          },
          400
        );
      }
      bbox = parsed.data;
    }

    try {
      const batch = FlightBatch.parse(await adapter.getFlights(bbox));
      return c.json(batch);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown provider error';
      return c.json({ error: message, source: 'opensky' }, 502);
    }
  });

  return router;
}
