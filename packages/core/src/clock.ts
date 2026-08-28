/**
 * Injectable sim-clock abstraction.
 * Enables deterministic simulation and freezing of time in tests without wall-clock drift.
 * Spec: PLAN.md §2 Rule 6.
 */

export interface SimClock {
  /** Returns the current timestamp in epoch milliseconds. */
  now(): number;
  /** Returns the ISO 8601 string representation of current clock time. */
  iso(): string;
}

/**
 * Frozen clock whose time never moves unless explicitly set.
 * Ideal for unit tests and reproducible scene replay.
 */
export class FrozenClock implements SimClock {
  private currentMs: number;

  constructor(initialMs = 1724580000000) {
    this.currentMs = initialMs;
  }

  now(): number {
    return this.currentMs;
  }

  iso(): string {
    return new Date(this.currentMs).toISOString();
  }

  setTime(ms: number): void {
    this.currentMs = ms;
  }
}

/**
 * Steppable clock allowing manual time advancements (ticks) or rate-scaled simulation time.
 */
export class SteppableClock implements SimClock {
  private currentMs: number;
  private rate: number;

  constructor(initialMs = 1724580000000, rate = 1) {
    this.currentMs = initialMs;
    this.rate = rate;
  }

  now(): number {
    return this.currentMs;
  }

  iso(): string {
    return new Date(this.currentMs).toISOString();
  }

  tick(deltaMs: number): void {
    this.currentMs += deltaMs * this.rate;
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  setTime(ms: number): void {
    this.currentMs = ms;
  }
}

/**
 * System clock backed by real wall-clock time (for production runtime only).
 */
export class SystemClock implements SimClock {
  now(): number {
    return Date.now();
  }

  iso(): string {
    return new Date().toISOString();
  }
}
