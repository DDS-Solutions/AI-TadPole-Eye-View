import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FrozenClock } from '../src/clock.js';
import {
  ViewportLookupGate,
  type ViewportSnapshot,
  shouldRefreshViewportLookup,
} from '../src/viewportLookupGate.js';

describe('Viewport Lookup Gate & Preflight Hygiene', () => {
  const baseViewport: ViewportSnapshot = {
    centerLat: 37.77,
    centerLon: -122.42,
    altitudeM: 10_000,
    spanLatDeg: 0.4,
    spanLonDeg: 0.4,
  };

  it('reuses cached context within 1/4 viewport pan and <2x altitude zoom', () => {
    expect(shouldRefreshViewportLookup(null, baseViewport)).toEqual({
      shouldRefresh: true,
      reason: 'initial_lookup',
    });

    const tinyPan: ViewportSnapshot = {
      ...baseViewport,
      centerLat: baseViewport.centerLat + 0.05,
      altitudeM: 15_000,
    };
    expect(shouldRefreshViewportLookup(baseViewport, tinyPan)).toEqual({
      shouldRefresh: false,
      reason: 'within_reuse_window',
    });

    const quarterPan: ViewportSnapshot = {
      ...baseViewport,
      centerLon: baseViewport.centerLon + 0.1,
    };
    expect(shouldRefreshViewportLookup(baseViewport, quarterPan)).toEqual({
      shouldRefresh: true,
      reason: 'viewport_panned',
    });

    const doubleAlt: ViewportSnapshot = { ...baseViewport, altitudeM: 20_000 };
    expect(shouldRefreshViewportLookup(baseViewport, doubleAlt)).toEqual({
      shouldRefresh: true,
      reason: 'altitude_changed',
    });

    const halfAlt: ViewportSnapshot = { ...baseViewport, altitudeM: 5_000 };
    expect(shouldRefreshViewportLookup(baseViewport, halfAlt)).toEqual({
      shouldRefresh: true,
      reason: 'altitude_changed',
    });
  });

  it('enforces /status preflight and SimClock cooldown before allowing refresh', () => {
    const clock = new FrozenClock(1_700_000_000_000);
    let statusHealthy = false;
    const gate = new ViewportLookupGate({
      clock,
      cooldownMs: 5_000,
      checkStatusPreflight: () => statusHealthy,
    });

    expect(gate.evaluate(baseViewport)).toEqual({
      allowed: false,
      reason: 'status_unavailable',
    });

    statusHealthy = true;
    expect(gate.evaluate(baseViewport)).toEqual({
      allowed: true,
      reason: 'initial_lookup',
    });
    gate.recordCompleted(baseViewport);

    const largePan: ViewportSnapshot = { ...baseViewport, centerLat: baseViewport.centerLat + 0.2 };
    expect(gate.evaluate(largePan)).toEqual({
      allowed: false,
      reason: 'cooldown_active',
    });

    clock.setTime(clock.now() + 5_000);
    expect(gate.evaluate(largePan)).toEqual({
      allowed: true,
      reason: 'viewport_panned',
    });
  });

  it('property: minor jitter under 20% viewport span and within 1.5x altitude never triggers refresh', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -0.07, max: 0.07, noNaN: true }),
        fc.double({ min: -0.07, max: 0.07, noNaN: true }),
        fc.double({ min: 0.65, max: 1.5, noNaN: true }),
        (dLat, dLon, altScale) => {
          const decision = shouldRefreshViewportLookup(baseViewport, {
            ...baseViewport,
            centerLat: baseViewport.centerLat + dLat,
            centerLon: baseViewport.centerLon + dLon,
            altitudeM: baseViewport.altitudeM * altScale,
          });
          expect(decision.shouldRefresh).toBe(false);
        }
      )
    );
  });
});
