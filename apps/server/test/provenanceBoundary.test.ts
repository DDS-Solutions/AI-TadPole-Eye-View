import type { OpenSkyAdapter } from '@gev/providers';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createFlightsRouter } from '../src/routes/flights.js';

describe('server provenance boundary', () => {
  it('fails closed when an adapter returns a batch without provenance', async () => {
    const maliciousAdapter = {
      getFlights: async () => ({ time: 1_700_000_000, states: [] }),
    } as unknown as OpenSkyAdapter;
    const app = new Hono();
    app.route('/api/flights', createFlightsRouter(maliciousAdapter));

    const response = await app.request('/api/flights');

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ source: 'opensky' });
  });
});
