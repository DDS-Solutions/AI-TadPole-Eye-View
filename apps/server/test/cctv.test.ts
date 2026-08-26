import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

describe('CCTV Media Proxy (PLAN.md §10 Phase 1 Item 5)', () => {
  it('GET /api/cctv/catalog lists camera network with filters', async () => {
    const { app } = createApp();

    const res = await app.request('/api/cctv/catalog');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.count).toBeGreaterThanOrEqual(4);
    expect(data.cameras.some((c: { id: string }) => c.id === 'caltrans-d4-baybridge')).toBe(true);
  });

  it('GET /api/cctv/catalog filters by agency and spatial bbox', async () => {
    const { app } = createApp();

    // Agency filter
    const caltransRes = await app.request('/api/cctv/catalog?agency=caltrans');
    expect(caltransRes.status).toBe(200);
    const caltransData = await caltransRes.json();
    expect(
      caltransData.cameras.every((c: { agency: string }) => c.agency.includes('Caltrans'))
    ).toBe(true);

    // Bbox filter
    const sfRes = await app.request(
      '/api/cctv/catalog?lamin=37.5&lamax=38.0&lomin=-122.5&lomax=-122.3'
    );
    expect(sfRes.status).toBe(200);
    const sfData = await sfRes.json();
    expect(sfData.cameras.some((c: { id: string }) => c.id === 'caltrans-d4-baybridge')).toBe(true);
    expect(sfData.cameras.some((c: { id: string }) => c.id === 'nycdot-timessquare')).toBe(false);
  });

  it('GET /api/cctv/snapshot/:id returns 404 for unknown camera ID', async () => {
    const { app } = createApp();

    const res = await app.request('/api/cctv/snapshot/nonexistent-cam');
    expect(res.status).toBe(404);
  });
});
