import {
  type BoundingBox,
  BoundingBox as BoundingBoxSchema,
  RadioCatalog,
  type RadioCategory,
  RadioCategory as RadioCategorySchema,
} from '@gev/contracts';
import type { RadioAdapter } from '@gev/providers';
import { pinnedFetch } from '@gev/security';
import { Hono } from 'hono';

export function createRadioRouter(adapter: RadioAdapter) {
  const router = new Hono();

  /**
   * GET /api/radio/catalog - Lists radio & ATC station frequencies
   */
  router.get('/catalog', async (c) => {
    let category: RadioCategory | undefined;
    const categoryParam = c.req.query('category');
    if (categoryParam) {
      const parsedCat = RadioCategorySchema.safeParse(categoryParam);
      if (parsedCat.success) {
        category = parsedCat.data;
      }
    }

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
      const catalog = RadioCatalog.parse(await adapter.getCatalog(category, bbox));
      return c.json(catalog);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown radio catalog error';
      return c.json({ error: message, source: 'radio' }, 502);
    }
  });

  /**
   * GET /api/radio/stream/:id - Proxies live audio stream with TLS pinning and SSRF protection
   */
  router.get('/stream/:id', async (c) => {
    const id = c.req.param('id');
    const station = await adapter.getStation(id);

    if (!station) {
      return c.json({ error: `Radio station '${id}' not found` }, 404);
    }

    try {
      const streamUrl = new URL(station.stream_url);

      const upstreamRes = await pinnedFetch(streamUrl, {
        headers: {
          Accept: '*/*',
          'User-Agent': 'GEV-Radio-Proxy/1.0',
        },
        allowedHosts: ['audio.broadcastify.com', 'liveatc.net', 'radio-browser.info'],
        timeoutMs: 10000,
        maxBytes: 100 * 1024 * 1024, // 100MB streaming cap per connection
      });

      const contentType = upstreamRes.headers.get('content-type') || 'audio/mpeg';

      // Forward stream headers
      c.header('Content-Type', contentType);
      c.header('Cache-Control', 'no-cache, no-store');
      c.header('X-GEV-Station-ID', station.id);
      c.header('X-GEV-Station-Name', encodeURIComponent(station.name));

      if (upstreamRes.body) {
        return c.body(upstreamRes.body as ReadableStream);
      }

      return c.text('Stream connected', 200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Stream unreachable';
      return c.json({ error: `Radio stream unavailable: ${message}`, station_id: id }, 502);
    }
  });

  return router;
}
