import crypto from 'node:crypto';
import { FrozenClock } from '@gev/core';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { describe, expect, it } from 'vitest';

const SAMPLE_INPUT = {
  business_name: 'Benchmark Precision Coffee LLC',
  naics_code: '722515',
  industry_title: 'Snack and Nonalcoholic Beverage Bars',
  target_geography: {
    level: 'county' as const,
    county_fips: '48453',
    state_fips: '48',
    name: 'Travis County, TX',
  },
  operating_radius_meters: 5000,
  employee_count_estimate: 16,
  annual_revenue_usd_estimate: 1_450_000,
};

describe('Task 13.1 BusinessContext Persistence & Export Performance', () => {
  it('meets performance threshold: persistence round-trip and export < 10ms p95', () => {
    const clock = new FrozenClock(Date.parse('2026-11-27T12:00:00.000Z'));
    const runtime = createGovernanceRuntimeContext({
      dbPath: ':memory:',
      clock,
      credentialEncryptionKey: crypto.randomBytes(32),
    });

    try {
      const store = runtime.businessContextStore;
      // Warmup JIT + SQLite statement cache
      for (let i = 0; i < 10; i += 1) {
        const id = `warmup-${i}`;
        store.createContext('tenant-bench', { context_id: id, input: SAMPLE_INPUT }, 'human');
        store.getContext('tenant-bench', id);
        store.exportContext('tenant-bench', id, 'human');
      }

      const roundTripMs: number[] = [];
      const exportMs: number[] = [];
      for (let i = 0; i < 60; i += 1) {
        const id = `bench-ctx-${i}`;
        const t0 = performance.now();
        store.createContext('tenant-bench', { context_id: id, input: SAMPLE_INPUT }, 'human');
        store.getContext('tenant-bench', id);
        roundTripMs.push(performance.now() - t0);

        const t1 = performance.now();
        store.exportContext('tenant-bench', id, 'human');
        exportMs.push(performance.now() - t1);
      }
      roundTripMs.sort((a, b) => a - b);
      exportMs.sort((a, b) => a - b);
      const roundTripP95 = roundTripMs[Math.floor(roundTripMs.length * 0.95)] ?? 0;
      const exportP95 = exportMs[Math.floor(exportMs.length * 0.95)] ?? 0;
      console.log(
        `[BENCHMARK] Task 13.1 BusinessContext (N=60): roundTrip p95=${roundTripP95.toFixed(3)}ms, export p95=${exportP95.toFixed(3)}ms`
      );
      expect(roundTripP95).toBeLessThan(10);
      expect(exportP95).toBeLessThan(10);
    } finally {
      runtime.close();
    }
  });
});
