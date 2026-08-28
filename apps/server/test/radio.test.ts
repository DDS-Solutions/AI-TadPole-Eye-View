import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

describe('Radio Proxy & Overpass Server Routes (PLAN.md §10 Phase 1 Items 3 & 4)', () => {
  it('GET /api/radio/catalog lists radio frequencies and ATC channels', async () => {
    const { app } = createApp();

    const res = await app.request('/api/radio/catalog');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.count).toBeGreaterThanOrEqual(4);
    expect(data.stations.some((s: { id: string }) => s.id === 'ksfo-tower')).toBe(true);
    expect(data.stations.some((s: { category: string }) => s.category === 'marine')).toBe(true);
  });

  it('GET /api/radio/catalog filters by category and bounding box', async () => {
    const { app } = createApp();

    // Filter ATC only
    const atcRes = await app.request('/api/radio/catalog?category=atc');
    expect(atcRes.status).toBe(200);
    const atcData = await atcRes.json();
    expect(atcData.stations.every((s: { category: string }) => s.category === 'atc')).toBe(true);

    // Filter California bbox
    const sfRes = await app.request(
      '/api/radio/catalog?lamin=36.0&lamax=39.0&lomin=-123.0&lomax=-121.0'
    );
    expect(sfRes.status).toBe(200);
    const sfData = await sfRes.json();
    expect(sfData.stations.some((s: { id: string }) => s.id === 'ksfo-tower')).toBe(true);
    expect(sfData.stations.some((s: { id: string }) => s.id === 'kjfk-tower')).toBe(false);
  });

  it('GET /api/radio/stream/:id returns 404 for unknown station', async () => {
    const { app } = createApp();

    const res = await app.request('/api/radio/stream/non-existent-station');
    expect(res.status).toBe(404);
  });

  it('POST /api/overpass sanitizes and executes valid queries', async () => {
    const clock = new FrozenClock(1_700_000_000_000);
    const { app } = createApp({ clock });

    const res = await app.request('/api/overpass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ql: 'node["amenity"="hospital"]; out;',
        bbox: { min_lat: 37.0, min_lon: -122.5, max_lat: 38.0, max_lon: -121.5 },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.elements.length).toBeGreaterThan(0);
    expect(data.sanitization.complexity_score).toBeGreaterThan(0);
    expect(data.osm3s.timestamp_osm_base).toBe(clock.iso());
  });

  it('POST /api/overpass rejects malicious unbounded query', async () => {
    const { app } = createApp();

    const res = await app.request('/api/overpass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ql: 'node["amenity"="hospital"]; out;',
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('OVERPASS_FAILED');
  });
});
