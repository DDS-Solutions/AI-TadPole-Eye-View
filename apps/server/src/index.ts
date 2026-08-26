import { BoundingBox } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { OpenSkyAdapter } from '@gev/providers';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

export interface ServerOptions {
  clock?: SimClock;
  port?: number;
  openSkyAdapter?: OpenSkyAdapter;
}

export function createApp(options: ServerOptions = {}) {
  const clock = options.clock ?? new SystemClock();
  const openSkyAdapter = options.openSkyAdapter ?? new OpenSkyAdapter({ clock });

  const app = new Hono();

  // Enable CORS for development
  app.use('*', cors());

  // Health and Feed Health Plane
  app.get('/api/health', (c) => {
    return c.json({
      status: 'ok',
      time: clock.now(),
      feeds: {
        opensky: { status: 'healthy', provider: 'opensky' },
      },
    });
  });

  // Flight Telemetry Proxy
  app.get('/api/flights', async (c) => {
    const minLatStr = c.req.query('min_lat') || c.req.query('lamin');
    const maxLatStr = c.req.query('max_lat') || c.req.query('lamax');
    const minLonStr = c.req.query('min_lon') || c.req.query('lomin');
    const maxLonStr = c.req.query('max_lon') || c.req.query('lomax');

    let bbox: BoundingBox | undefined;

    if (minLatStr && maxLatStr && minLonStr && maxLonStr) {
      const min_lat = Number.parseFloat(minLatStr);
      const max_lat = Number.parseFloat(maxLatStr);
      const min_lon = Number.parseFloat(minLonStr);
      const max_lon = Number.parseFloat(maxLonStr);

      const parsed = BoundingBox.safeParse({ min_lat, max_lat, min_lon, max_lon });
      if (parsed.success) {
        bbox = parsed.data;
      }
    }

    try {
      const batch = await openSkyAdapter.getFlights(bbox);
      return c.json(batch);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown provider error';
      return c.json({ error: message, source: 'opensky' }, 502);
    }
  });

  return app;
}

// Auto-start when executed directly
const isDirectExecution =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('apps/server/src/index.ts') ||
  process.argv[1]?.endsWith('apps\\server\\src\\index.ts') ||
  process.argv[1]?.endsWith('apps/server/dist/index.js') ||
  process.argv[1]?.endsWith('apps\\server\\dist\\index.js');

if (isDirectExecution || process.env.NODE_ENV !== 'test') {
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  const app = createApp();
  serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      console.log(`[GEV v2 Server] Hono server listening on http://localhost:${info.port}`);
    }
  );
}
