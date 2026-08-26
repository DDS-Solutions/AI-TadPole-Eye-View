import { describe, expect, it } from 'vitest';
import { runDemo } from '../src/commands/demo.js';

describe('Governed Agent Team Live Showcase (PLAN.md §10 Phase 4)', () => {
  it('executes full M1-M3 governed scenario without errors', async () => {
    const result = await runDemo();

    expect(result.success).toBe(true);
    expect(result.eventsRecorded).toBeGreaterThanOrEqual(4);
    expect(result.merkleHead).toHaveLength(64);
    expect(result.stasisTripRecovered).toBe(true);
  });
});
