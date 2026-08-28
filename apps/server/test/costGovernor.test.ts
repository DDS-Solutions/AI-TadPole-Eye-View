import { FrozenClock } from '@gev/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';
import { CostGovernor } from '../src/middleware/costGovernor.js';

describe('Cost Governor Middleware & Data Proxies (PLAN.md §10 Phase 1)', () => {
  it('serves telemetry feeds with Cost Governor headers (flights, ships, quakes, firms, gbfs)', async () => {
    const { app } = createApp();

    // Flights
    const flightsRes = await app.request('/api/flights');
    expect(flightsRes.status).toBe(200);
    const flightsData = await flightsRes.json();
    expect(Array.isArray(flightsData.states)).toBe(true);

    // Ships
    const shipsRes = await app.request('/api/ships');
    expect(shipsRes.status).toBe(200);
    const shipsData = await shipsRes.json();
    expect(Array.isArray(shipsData.ships)).toBe(true);
    expect(shipsData.ships.length).toBeGreaterThan(0);

    // Quakes
    const quakesRes = await app.request('/api/quakes');
    expect(quakesRes.status).toBe(200);
    const quakesData = await quakesRes.json();
    expect(Array.isArray(quakesData.features)).toBe(true);
    expect(quakesData.features.length).toBeGreaterThan(0);

    // Firms
    const firmsRes = await app.request('/api/firms');
    expect(firmsRes.status).toBe(200);
    const firmsData = await firmsRes.json();
    expect(Array.isArray(firmsData.hotspots)).toBe(true);
    expect(firmsData.hotspots.length).toBeGreaterThan(0);

    // GBFS
    const gbfsRes = await app.request('/api/gbfs');
    expect(gbfsRes.status).toBe(200);
    const gbfsData = await gbfsRes.json();
    expect(Array.isArray(gbfsData.stations)).toBe(true);
    expect(gbfsData.stations.length).toBeGreaterThan(0);
  });

  it('enforces TTL cache hits on repeated calls', async () => {
    const { app } = createApp();

    // First call: MISS
    const res1 = await app.request('/api/ships');
    expect(res1.status).toBe(200);

    // Second call within 15s TTL: HIT
    const res2 = await app.request('/api/ships');
    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-GEV-Cache')).toBe('HIT');
    expect(res2.headers.get('X-GEV-TTL-Sec')).toBe('15');
  });

  it('filters results by bounding box query parameters across all feeds', async () => {
    const { app } = createApp();

    // California Bounding Box
    const bboxParams = '?lamin=36.0&lamax=38.5&lomin=-123.0&lomax=-121.0';

    const shipsRes = await app.request(`/api/ships${bboxParams}`);
    expect(shipsRes.status).toBe(200);
    const shipsData = await shipsRes.json();
    expect(shipsData.ships.some((s: { name: string }) => s.name === 'GOLDEN GATE FERRY')).toBe(
      true
    );

    const quakesRes = await app.request(`/api/quakes${bboxParams}`);
    expect(quakesRes.status).toBe(200);
    const quakesData = await quakesRes.json();
    expect(
      quakesData.features.some((f: { place: string }) => f.place.includes('San Juan Bautista'))
    ).toBe(true);
  });

  it('evaluates HTTP-date Retry-After headers against the injected clock', async () => {
    const clock = new FrozenClock(Date.parse('2026-08-28T12:00:00.000Z'));
    const governor = new CostGovernor({ clock });
    const app = new Hono();
    app.use('/feed/*', governor.middleware('ships'));
    app.get('/feed/data', (c) => {
      c.header('Retry-After', 'Fri, 28 Aug 2026 12:02:00 GMT');
      return c.json({ error: 'rate limited' }, 429);
    });

    expect((await app.request('/feed/data')).status).toBe(429);
    const cooldownResponse = await app.request('/feed/data');

    expect(cooldownResponse.status).toBe(429);
    expect(cooldownResponse.headers.get('Retry-After')).toBe('120');
  });
});
