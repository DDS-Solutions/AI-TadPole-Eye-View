import type { SimClock } from './clock.js';

export const DEFAULT_VIEWPORT_PAN_RATIO = 0.25;
export const DEFAULT_ALTITUDE_INCREASE_FACTOR = 2.0;
export const DEFAULT_ALTITUDE_DECREASE_FACTOR = 0.5;

export interface ViewportSnapshot {
  readonly centerLat: number;
  readonly centerLon: number;
  readonly altitudeM: number;
  readonly spanLatDeg: number;
  readonly spanLonDeg: number;
}

export interface ViewportRefreshThresholds {
  readonly minPanFraction?: number;
  readonly maxAltitudeMultiplier?: number;
  readonly minAltitudeMultiplier?: number;
}

export type ViewportRefreshReason =
  | 'initial_lookup'
  | 'viewport_panned'
  | 'altitude_changed'
  | 'within_reuse_window';

export interface ViewportRefreshDecision {
  readonly shouldRefresh: boolean;
  readonly reason: ViewportRefreshReason;
}

/**
 * Determines whether a viewport change justifies a fresh reverse-geocode/context query.
 * Reuses cached context unless camera pans >= 1/4 viewport span or altitude shifts 2x / 0.5x.
 */
export function shouldRefreshViewportLookup(
  previous: ViewportSnapshot | null,
  next: ViewportSnapshot,
  thresholds: ViewportRefreshThresholds = {}
): ViewportRefreshDecision {
  if (!previous) {
    return { shouldRefresh: true, reason: 'initial_lookup' };
  }

  const minPanFraction = thresholds.minPanFraction ?? DEFAULT_VIEWPORT_PAN_RATIO;
  const maxAltFactor = thresholds.maxAltitudeMultiplier ?? DEFAULT_ALTITUDE_INCREASE_FACTOR;
  const minAltFactor = thresholds.minAltitudeMultiplier ?? DEFAULT_ALTITUDE_DECREASE_FACTOR;

  const spanLat = Math.max(Math.abs(previous.spanLatDeg), 1e-6);
  const spanLon = Math.max(Math.abs(previous.spanLonDeg), 1e-6);
  const latShiftRatio = Math.abs(next.centerLat - previous.centerLat) / spanLat;
  const lonShiftRatio = Math.abs(next.centerLon - previous.centerLon) / spanLon;

  if (latShiftRatio + 1e-9 >= minPanFraction || lonShiftRatio + 1e-9 >= minPanFraction) {
    return { shouldRefresh: true, reason: 'viewport_panned' };
  }

  const prevAlt = Math.max(previous.altitudeM, 1);
  const nextAlt = Math.max(next.altitudeM, 1);
  const altRatio = nextAlt / prevAlt;
  if (altRatio + 1e-9 >= maxAltFactor || altRatio - 1e-9 <= minAltFactor) {
    return { shouldRefresh: true, reason: 'altitude_changed' };
  }

  return { shouldRefresh: false, reason: 'within_reuse_window' };
}

export interface ViewportLookupGateOptions extends ViewportRefreshThresholds {
  readonly clock: SimClock;
  readonly cooldownMs?: number;
  readonly checkStatusPreflight?: () => boolean;
}

export interface ViewportLookupPermission {
  readonly allowed: boolean;
  readonly reason: ViewportRefreshReason | 'status_unavailable' | 'cooldown_active';
}

/**
 * Stateful lookup guard combining `/status` preflight, viewport reuse thresholds, and cooldown.
 */
export class ViewportLookupGate {
  private lastViewport: ViewportSnapshot | null = null;
  private lastQueryAtMs: number | null = null;

  constructor(private readonly options: ViewportLookupGateOptions) {}

  evaluate(next: ViewportSnapshot): ViewportLookupPermission {
    if (this.options.checkStatusPreflight && !this.options.checkStatusPreflight()) {
      return { allowed: false, reason: 'status_unavailable' };
    }

    const decision = shouldRefreshViewportLookup(this.lastViewport, next, this.options);
    if (!decision.shouldRefresh) {
      return { allowed: false, reason: decision.reason };
    }

    const cooldownMs = this.options.cooldownMs ?? 0;
    const nowMs = this.options.clock.now();
    if (this.lastQueryAtMs !== null && cooldownMs > 0 && nowMs - this.lastQueryAtMs < cooldownMs) {
      return { allowed: false, reason: 'cooldown_active' };
    }

    return { allowed: true, reason: decision.reason };
  }

  recordCompleted(viewport: ViewportSnapshot): void {
    this.lastViewport = { ...viewport };
    this.lastQueryAtMs = this.options.clock.now();
  }

  reset(): void {
    this.lastViewport = null;
    this.lastQueryAtMs = null;
  }
}
