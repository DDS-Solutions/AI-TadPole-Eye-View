import assert from 'node:assert/strict';
import {
  DisposalStack,
  FrozenClock,
  ViewportLookupGate,
  segmentTrailFixes,
} from '../packages/core/dist/index.js';
import { consumeDailyBudget, utcDayKey } from '../packages/governance/dist/index.js';

const WARMUP_ITERATIONS = 50;
const BENCHMARK_ITERATIONS = 500;
const MAX_HEAP_BYTES_PER_ITERATION = 24 * 1024;

function runHotLoop(iterations) {
  const clock = new FrozenClock(1_760_000_000_000);
  const gate = new ViewportLookupGate({
    clock,
    cooldownMs: 1_000,
    checkStatusPreflight: () => true,
  });
  let budgetState = null;

  for (let i = 0; i < iterations; i++) {
    const dayKey = utcDayKey(clock.now());
    const budget = consumeDailyBudget(budgetState, dayKey, 100_000, 1);
    budgetState = budget.state;

    const fixes = [];
    for (let p = 0; p < 20; p++) {
      fixes.push({
        lat: 37.6 + p * 0.002,
        lon: -122.4 + p * 0.002,
        altitudeM: 9_000 + p * 10,
        timeMs: 1_000_000 + p * 30_000,
      });
    }
    const segments = segmentTrailFixes(fixes);
    assert.equal(segments.length, 1);

    gate.evaluate({
      centerLat: 37.77 + (i % 10) * 0.001,
      centerLon: -122.42,
      altitudeM: 10_000,
      spanLatDeg: 0.4,
      spanLonDeg: 0.4,
    });
    clock.setTime(clock.now() + 2_000);
  }
}

runHotLoop(WARMUP_ITERATIONS);
const disposeCheck = new DisposalStack();
let cleaned = 0;
disposeCheck.defer(() => {
  cleaned += 1;
});
await disposeCheck.dispose();
assert.equal(cleaned, 1);

if (typeof globalThis.gc === 'function') {
  globalThis.gc();
}
const beforeHeap = process.memoryUsage().heapUsed;
runHotLoop(BENCHMARK_ITERATIONS);
if (typeof globalThis.gc === 'function') {
  globalThis.gc();
}
const afterHeap = process.memoryUsage().heapUsed;
const deltaBytes = Math.max(0, afterHeap - beforeHeap);
const bytesPerIteration = deltaBytes / BENCHMARK_ITERATIONS;

console.log(
  `[ALLOC-GATE] Node ${process.version} | ${BENCHMARK_ITERATIONS} iterations | heapDelta=${deltaBytes}B | perIter=${bytesPerIteration.toFixed(1)}B (max ${MAX_HEAP_BYTES_PER_ITERATION}B)`
);
assert.ok(
  bytesPerIteration <= MAX_HEAP_BYTES_PER_ITERATION,
  `Allocation gate exceeded: ${bytesPerIteration.toFixed(1)}B/iter > ${MAX_HEAP_BYTES_PER_ITERATION}B/iter`
);
