import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { FlightBatch } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { describe, expect, it, vi } from 'vitest';
import { OpenSkyAdapter } from '../src/opensky.js';

describe('OpenSky Provider Adapter (@gev/providers)', () => {
  const fixturePath = path.resolve(process.cwd(), '..', '..', 'fixtures', 'flights-opensky.json');
  const frozenTime = 1724641200000;

  it('replays seed fixture deterministically using FrozenClock with zero live calls', async () => {
    const clock = new FrozenClock(frozenTime);
    const adapter = new OpenSkyAdapter({
      clock,
      seedFixturePath: fixturePath,
      seedMode: true,
    });

    const batch = await adapter.getFlights();

    expect(batch.time).toBe(Math.floor(frozenTime / 1000));
    expect(batch.states.length).toBe(10000);
    expect(FlightBatch.safeParse(batch).success).toBe(true);

    const first = batch.states[0];
    expect(first).toBeDefined();
    expect(first?.icao24).toBeDefined();
    expect(typeof first?.latitude).toBe('number');
    expect(typeof first?.longitude).toBe('number');
  });

  it('filters flights by bounding box in seed mode', async () => {
    const clock = new FrozenClock(frozenTime);
    const adapter = new OpenSkyAdapter({
      clock,
      seedFixturePath: fixturePath,
      seedMode: true,
    });

    // NYC bounding box
    const nycBox = {
      min_lat: 40.0,
      max_lat: 41.5,
      min_lon: -74.5,
      max_lon: -73.0,
    };

    const batch = await adapter.getFlights(nycBox);

    expect(batch.states.length).toBeGreaterThan(0);
    expect(batch.states.length).toBeLessThan(10000);

    for (const flight of batch.states) {
      if (flight.latitude !== null && flight.longitude !== null) {
        expect(flight.latitude).toBeGreaterThanOrEqual(nycBox.min_lat);
        expect(flight.latitude).toBeLessThanOrEqual(nycBox.max_lat);
        expect(flight.longitude).toBeGreaterThanOrEqual(nycBox.min_lon);
        expect(flight.longitude).toBeLessThanOrEqual(nycBox.max_lon);
      }
    }
  });

  it('GUARD TEST: opens zero network sockets under seed mode', async () => {
    const socketSpy = vi.spyOn(net, 'connect');
    const clock = new FrozenClock(frozenTime);
    const adapter = new OpenSkyAdapter({
      clock,
      seedFixturePath: fixturePath,
      seedMode: true,
    });

    await adapter.getFlights();

    expect(socketSpy).not.toHaveBeenCalled();
    socketSpy.mockRestore();
  });

  it('BENCHMARK: parses 10,000 aircraft records < 50ms p95 across 50 iterations', async () => {
    const clock = new FrozenClock(frozenTime);
    const adapter = new OpenSkyAdapter({
      clock,
      seedFixturePath: fixturePath,
      seedMode: true,
    });

    const iterations = 50;
    const durations: number[] = [];

    // Warm-up
    await adapter.getFlights();

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const batch = await adapter.getFlights();
      const end = performance.now();
      expect(batch.states.length).toBe(10000);
      durations.push(end - start);
    }

    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(iterations * 0.5)];
    const p95 = durations[Math.floor(iterations * 0.95)];
    const max = durations[iterations - 1];

    console.log(
      `[Benchmark OpenSky 10k Replay] N=${iterations} | p50: ${p50?.toFixed(2)}ms | p95: ${p95?.toFixed(2)}ms | max: ${max?.toFixed(2)}ms`
    );

    expect(p95).toBeLessThan(50);
  });
});
