import { type BoundingBox, BoundingBox as BoundingBoxSchema, CctvCatalog } from '@gev/contracts';
import type { CctvAdapter } from '@gev/providers';
import { pinnedFetch } from '@gev/security';
import { Hono } from 'hono';

export function createCctvRouter(adapter: CctvAdapter) {
  const router = new Hono();

  /**
   * GET /api/cctv/catalog - Lists traffic cameras
   */
  router.get('/catalog', async (c) => {
    const agency = c.req.query('agency');

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
      const catalog = CctvCatalog.parse(await adapter.getCatalog(agency, bbox));
      return c.json(catalog);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown CCTV catalog error';
      return c.json({ error: message, source: 'cctv' }, 502);
    }
  });

  /**
   * GET /api/cctv/snapshot/:id - Proxies camera image snapshot with abort timeout lifecycle
   */
  router.get('/snapshot/:id', async (c) => {
    const id = c.req.param('id');
    const camera = await adapter.getCamera(id);

    if (!camera) {
      return c.json({ error: `CCTV camera '${id}' not found` }, 404);
    }

    try {
      const snapshotUrl = new URL(camera.snapshot_url);

      const upstreamRes = await pinnedFetch(snapshotUrl, {
        headers: {
          Accept: 'image/jpeg, image/png, image/*, */*',
          'User-Agent': 'GEV-CCTV-Proxy/1.0',
        },
        allowedHosts: [
          'cctv.dot.ca.gov',
          'nyctmc.org',
          's3-eu-west-1.amazonaws.com',
          'jamcams.tfl.gov.uk',
        ],
        timeoutMs: 8000,
        maxBytes: 5 * 1024 * 1024,
      });

      if (!upstreamRes.ok) {
        throw new Error(`Upstream returned HTTP ${upstreamRes.status}`);
      }

      const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
      c.header('Content-Type', contentType);
      c.header('Cache-Control', `public, max-age=${camera.refresh_interval_sec}`);
      c.header('X-GEV-Camera-ID', camera.id);

      const buffer = await upstreamRes.arrayBuffer();
      return c.body(buffer);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Camera unreachable';
      return c.json({ error: `CCTV snapshot unavailable: ${message}`, camera_id: id }, 502);
    }
  });

  return router;
}
