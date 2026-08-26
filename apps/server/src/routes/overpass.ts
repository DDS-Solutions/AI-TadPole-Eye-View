import { OverpassQueryRequest } from '@gev/contracts';
import { pinnedFetch, sanitizeOverpassQuery } from '@gev/security';
import { Hono } from 'hono';

export interface OverpassRouterOptions {
  seedMode?: boolean;
}

export function createOverpassRouter(options: OverpassRouterOptions = {}) {
  const router = new Hono();
  const isSeedMode =
    options.seedMode ??
    (process.env.GEV_SEED_MODE === '1' ||
      process.env.GEV_LIVE_MODE !== '1' ||
      process.env.NODE_ENV === 'test');

  /**
   * POST /api/overpass - Sanitizes and executes Overpass QL queries
   */
  router.post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON request body' }, 400);
    }

    const parsed = OverpassQueryRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.issues }, 400);
    }

    try {
      const sanitized = sanitizeOverpassQuery(parsed.data.ql, {
        maxTimeoutSec: 25,
        defaultTimeoutSec: parsed.data.timeout_seconds,
        fallbackBbox: parsed.data.bbox,
      });

      if (isSeedMode) {
        return c.json({
          version: 0.6,
          generator: 'GEV-Overpass-Seed/1.0',
          osm3s: {
            timestamp_osm_base: new Date().toISOString(),
            copyright: 'The data included in this document is from www.openstreetmap.org.',
          },
          elements: [
            {
              type: 'node',
              id: 10001,
              lat: sanitized.bbox?.min_lat ? sanitized.bbox.min_lat + 0.05 : 37.7749,
              lon: sanitized.bbox?.min_lon ? sanitized.bbox.min_lon + 0.05 : -122.4194,
              tags: {
                amenity: 'hospital',
                name: 'San Francisco General Hospital',
              },
            },
          ],
          sanitization: {
            complexity_score: sanitized.complexity_score,
            timeout_sec: sanitized.timeout_sec,
          },
        });
      }

      // Live mode via pinnedFetch
      const url = new URL('https://overpass-api.de/api/interpreter');
      const upstreamRes = await pinnedFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: `data=${encodeURIComponent(sanitized.sanitized_ql)}`,
        allowedHosts: ['overpass-api.de', 'overpass.kumi.systems'],
        allowedPaths: [{ host: 'overpass-api.de', pathPrefix: '/api/interpreter' }],
        timeoutMs: sanitized.timeout_sec * 1000,
        maxBytes: 15 * 1024 * 1024,
      });

      if (!upstreamRes.ok) {
        throw new Error(`Overpass API returned HTTP ${upstreamRes.status}`);
      }

      const json = await upstreamRes.json();
      return c.json(json);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown Overpass error';
      return c.json({ error: message, code: 'OVERPASS_FAILED' }, 400);
    }
  });

  return router;
}
