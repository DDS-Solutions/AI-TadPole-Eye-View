import { ShipBatch } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';
import { CostGovernor } from '../src/middleware/costGovernor.js';

describe('Cost Governor Middleware & Data Proxies (PLAN.md §10 Phase 1)', () => {
  it('serves telemetry feeds with Cost Governor headers (flights, ships, quakes, firms, gbfs)', async () => {
    const { app, budgetGovernor } = createApp();

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
    expect(budgetGovernor.state().spent_usd).toBe(0);
  });

  it('enforces TTL cache hits on repeated calls', async () => {
    const clock = new FrozenClock(1724580000000);
    const { app } = createApp({ clock });

    // First call: MISS
    const res1 = await app.request('/api/ships');
    expect(res1.status).toBe(200);
    const first = ShipBatch.parse(await res1.json());
    expect(first.provenance.mode).toBe('seed');

    // Second call within 15s TTL: HIT
    const res2 = await app.request('/api/ships');
    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-GEV-Cache')).toBe('HIT');
    expect(res2.headers.get('X-GEV-TTL-Sec')).toBe('15');
    const second = ShipBatch.parse(await res2.json());
    expect(second.provenance).toMatchObject({
      mode: 'cached',
      source_mode: 'seed',
      retrieved_at: clock.iso(),
    });
    expect(second.provenance.cache).toMatchObject({
      stored_at: clock.iso(),
      origin_retrieved_at: first.provenance.retrieved_at,
    });
    expect(second.provenance.cache?.cache_id).toMatch(/^cache-[0-9a-f]{32}$/);
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
    const governor = new CostGovernor({
      clock,
      tiers: {
        ships: { ttlSeconds: 15, costPerFetchUsd: 0, maxStaleSeconds: 300 },
      },
    });
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

  it('replays a retained billable operation ID after TTL expiry without double spend', async () => {
    const clock = new FrozenClock(Date.parse('2026-08-28T12:00:00.000Z'));
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:', capUsd: 1 });
    const governor = new CostGovernor({
      clock,
      budgetLedger: runtime.budgetLedger,
      tiers: {
        test: { ttlSeconds: 5, costPerFetchUsd: 0.0001, maxStaleSeconds: 60 },
      },
    });
    const app = new Hono();
    app.use('/feed/*', governor.middleware('test'));
    app.get('/feed/data', (c) => c.json({ stable: true }));
    const operationId = '00000000-0000-4000-8000-000000000321';
    try {
      const first = await app.request('/feed/data', {
        headers: { 'Idempotency-Key': operationId },
      });
      expect(first.status).toBe(200);
      expect(runtime.budgetGovernor.state().spent_usd).toBe(0.0001);

      clock.setTime(clock.now() + 6_000);
      const replay = await app.request('/feed/data', {
        headers: { 'Idempotency-Key': operationId },
      });
      expect(replay.status).toBe(200);
      expect(replay.headers.get('X-GEV-Idempotent-Replay')).toBe('true');
      expect(runtime.budgetGovernor.state().spent_usd).toBe(0.0001);

      const conflict = await app.request('/feed/data?different=true', {
        headers: { 'Idempotency-Key': operationId },
      });
      expect(conflict.status).toBe(409);
      await expect(conflict.json()).resolves.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    } finally {
      runtime.close();
    }
  });

  it('fails closed before a billable route when no durable ledger is composed', async () => {
    const governor = new CostGovernor();
    const app = new Hono();
    app.use('/feed/*', governor.middleware('ships'));
    app.get('/feed/data', (c) => c.json({ should_not_execute: true }));

    const response = await app.request('/feed/data');
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'LEDGER_UNAVAILABLE' });
  });

  it('refunds reservation and avoids spend when serving stale-cache fallback on upstream failure (G-03)', async () => {
    const clock = new FrozenClock(Date.parse('2026-08-28T12:00:00.000Z'));
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:', capUsd: 1 });
    const governor = new CostGovernor({
      clock,
      budgetLedger: runtime.budgetLedger,
      tiers: {
        test: { ttlSeconds: 5, costPerFetchUsd: 0.0001, maxStaleSeconds: 60 },
      },
    });
    const app = new Hono();
    let upstreamFail = false;
    app.use('/feed/*', governor.middleware('test'));
    app.get('/feed/data', (c) => {
      if (upstreamFail) return c.json({ error: 'upstream failure' }, 500);
      return c.json({ data: 'live-value' });
    });

    const opId1 = '00000000-0000-4000-8000-000000000001';
    const opId2 = '00000000-0000-4000-8000-000000000002';
    try {
      // 1. Initial live fetch succeeds and bills $0.0001
      const res1 = await app.request('/feed/data', { headers: { 'Idempotency-Key': opId1 } });
      expect(res1.status).toBe(200);
      expect(runtime.budgetGovernor.state().spent_usd).toBe(0.0001);

      // 2. TTL expires (6s later), upstream fails with 500
      clock.setTime(clock.now() + 6_000);
      upstreamFail = true;

      const res2 = await app.request('/feed/data', { headers: { 'Idempotency-Key': opId2 } });
      expect(res2.status).toBe(200);
      expect(res2.headers.get('X-GEV-Stale')).toBe('true');
      expect(res2.headers.get('X-GEV-Cache-Source')).toBe('error-fallback');

      // Crucial: Spend is NOT incremented; operation 2 was refunded with evidence
      expect(runtime.budgetGovernor.state().spent_usd).toBe(0.0001);
      const op2 = runtime.budgetLedger.lookup(opId2);
      expect(op2?.state).toBe('REFUNDED');
      expect(op2?.evidence?.summary).toContain('Served stale cached response');
    } finally {
      runtime.close();
    }
  });

  it('canonicalizes query parameters, ensuring cache hits and identical billing fingerprints (G-05)', async () => {
    const clock = new FrozenClock(1724580000000);
    const { app } = createApp({ clock });

    // Request 1: cache miss
    const res1 = await app.request('/api/flights?lamax=38.5&lamin=36.0&lomax=-121.0&lomin=-123.0');
    expect(res1.status).toBe(200);
    expect(res1.headers.get('X-GEV-Cache')).toBe('MISS');

    // Request 2 with reversed parameter order: must be a cache HIT
    const res2 = await app.request('/api/flights?lomin=-123.0&lomax=-121.0&lamin=36.0&lamax=38.5');
    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-GEV-Cache')).toBe('HIT');

    // Request 3 with random extraneous parameter: must still be a cache HIT
    const res3 = await app.request(
      '/api/flights?lamin=36.0&lamax=38.5&lomin=-123.0&lomax=-121.0&attacker_rand=9999'
    );
    expect(res3.status).toBe(200);
    expect(res3.headers.get('X-GEV-Cache')).toBe('HIT');
  });

  it('refunds reservation and returns 500 when provider response exceeds durable replay bounds (G-07)', async () => {
    const clock = new FrozenClock(Date.parse('2026-08-28T12:00:00.000Z'));
    const runtime = createGovernanceRuntimeContext({ clock, dbPath: ':memory:', capUsd: 1 });
    const governor = new CostGovernor({
      clock,
      budgetLedger: runtime.budgetLedger,
      tiers: {
        test: { ttlSeconds: 5, costPerFetchUsd: 0.0001, maxStaleSeconds: 60 },
      },
    });
    const app = new Hono();
    app.use('/feed/*', governor.middleware('test'));
    app.get('/feed/data', (c) => c.json({ payload: 'x'.repeat(300_000) }));

    const opId = '00000000-0000-4000-8000-000000000099';
    try {
      const res = await app.request('/feed/data', { headers: { 'Idempotency-Key': opId } });
      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toMatchObject({ code: 'OUTPUT_TOO_LARGE' });

      // Crucial: Spend was NOT committed; operation was refunded
      expect(runtime.budgetGovernor.state().spent_usd).toBe(0);
      const op = runtime.budgetLedger.lookup(opId);
      expect(op?.state).toBe('REFUNDED');
      expect(op?.evidence?.summary).toContain('exceeded durable replay bounds');
    } finally {
      runtime.close();
    }
  });
});
