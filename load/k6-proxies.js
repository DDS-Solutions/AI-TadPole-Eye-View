import { check, sleep } from 'k6';
import http from 'k6/http';

/**
 * GEV v2 Proxy Load Benchmark (PLAN.md §10 Phase 4 & §13)
 * Benchmarks Hono server proxies under concurrent Virtual User (VU) load.
 *
 * Usage:
 *   k6 run load/k6-proxies.js
 *   k6 run -e BASE_URL=http://localhost:3000 load/k6-proxies.js
 */

export const options = {
  stages: [
    { duration: '5s', target: 20 }, // Ramp-up to 20 VUs
    { duration: '10s', target: 50 }, // Sustain peak at 50 VUs
    { duration: '5s', target: 0 }, // Ramp-down to 0 VUs
  ],
  thresholds: {
    // 95% of cached proxy responses must complete under 50ms (PLAN.md §7.1 & §13)
    http_req_duration: ['p(95)<50'],
    // Error rate must remain under 1%
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export default function () {
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
    '/ops/audit?limit=20',
  ];

  // Pick random endpoint to simulate distributed operator traffic
  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
  const url = `${BASE_URL}${endpoint}`;

  const res = http.get(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'k6-load-benchmark/1.0',
    },
    timeout: '2000ms',
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response has content-type json': (r) =>
      r.headers['Content-Type']?.includes('application/json'),
    'response duration < 50ms': (r) => r.timings.duration < 50,
  });

  // Jittered sleep between 50ms and 150ms per VU
  sleep(0.05 + Math.random() * 0.1);
}
