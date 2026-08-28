import { type SimClock, SystemClock } from '@gev/core';

/** Browser composition-root clock shared by UI stores and components. */
export const runtimeClock: SimClock = new SystemClock();
