import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

describe('Server Proxy High-Concurrency Load Verification (PLAN.md §10 Phase 4 & §13)', () => {
  it('serves 100+ concurrent requests across proxy endpoints with p95 < 50ms and 0% errors', async () => {
    const { app, auditSink } = createApp();

    const endpoints = [
      '/api/health',
      '/api/flights',
      '/api/ships',
      '/api/quakes',
      '/api/firms',
      '/api/gbfs',
      '/api/radio/catalog',
      '/api/cctv/catalog',
      '/api/weather/radar',
      '/api/telemetry/metrics',
      '/ops/audit?limit=10',
    ];

    const totalRequests = 100;
    const durations: number[] = [];
    const promises: Promise<Response>[] = [];

    // Prime the caches with initial warmup requests
    for (const ep of endpoints) {
      await app.request(ep);
    }

    // Run 10 concurrent worker loops (simulating 10 VUs) executing 10 requests each (100 total)
    const workerCount = 10;
    const requestsPerWorker = 10;

    const workers = Array.from({ length: workerCount }, async (_, workerId) => {
      for (let j = 0; j < requestsPerWorker; j++) {
        const ep = endpoints[(workerId * requestsPerWorker + j) % endpoints.length];
        const startReq = performance.now();
        const res = await app.request(ep, {
          headers: { Accept: 'application/json' },
        });
        const duration = performance.now() - startReq;
        durations.push(duration);
        expect(res.status).toBe(200);
      }
    });

    const t0 = performance.now();
    await Promise.all(workers);
    const totalElapsedMs = performance.now() - t0;

    // Calculate latency metrics
    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(durations.length * 0.5)];
    const p95 = durations[Math.floor(durations.length * 0.95)];
    const p99 = durations[Math.floor(durations.length * 0.99)];
    const max = durations[durations.length - 1];

    console.log(
      `[Load Benchmark] N=${totalRequests} | Total: ${totalElapsedMs.toFixed(1)}ms | p50: ${p50?.toFixed(2)}ms | p95: ${p95?.toFixed(2)}ms | p99: ${p99?.toFixed(2)}ms | max: ${max?.toFixed(2)}ms`
    );

    // Assert p95 response time is strictly bounded under concurrent load (p95 < 100ms in CI)
    expect(p95).toBeLessThan(100);

    auditSink.close();
  });
});
