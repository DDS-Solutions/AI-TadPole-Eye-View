import { describe, expect, it } from 'vitest';
import { runDemo } from '../src/commands/demo.js';

describe('Local governance seed simulation', () => {
  it('labels and executes the local M1-M3-shaped scenario without errors', async () => {
    const result = await runDemo();

    expect(result.success).toBe(true);
    expect(result.simulation).toBe('local-seed');
    expect(result.eventsRecorded).toBeGreaterThanOrEqual(4);
    expect(result.merkleHead).toHaveLength(64);
    expect(result.durableAuditValid).toBe(true);
    expect(result.stasisTripRecovered).toBe(true);
  });
});
