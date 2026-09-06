import { FrozenClock, type SimClock } from '@gev/core';

/** Resolves an optional deterministic clock for seed demos and browser verification only. */
export function resolveServerClockFromEnvironment(): SimClock | undefined {
  const configured = process.env.GEV_SEED_SIM_TIME_MS;
  if (configured === undefined) return undefined;
  if (process.env.GEV_LIVE_MODE === '1' && process.env.GEV_SEED_MODE !== '1') {
    throw new Error('GEV_SEED_SIM_TIME_MS cannot be used for live provider mode');
  }
  const milliseconds = Number(configured);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error('GEV_SEED_SIM_TIME_MS must be a nonnegative epoch-millisecond value');
  }
  return new FrozenClock(milliseconds);
}
