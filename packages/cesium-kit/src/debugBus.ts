import type { FlightLayerController } from './flightLayer.js';
import type { GlobeController } from './globe.js';

export interface GevDebugBus {
  isReady: () => boolean;
  getEntityCount: () => number;
  getFlightIds: () => string[];
  getCameraHeight: () => number;
}

declare global {
  interface Window {
    __gev?: GevDebugBus;
  }
}

/**
 * Attaches the window.__gev debug bus for E2E condition-wait assertions.
 */
export function attachDebugBus(
  globe: GlobeController,
  flightLayer?: FlightLayerController
): GevDebugBus {
  const bus: GevDebugBus = {
    isReady: () => !globe.viewer.isDestroyed(),
    getEntityCount: () => flightLayer?.getEntityCount() ?? 0,
    getFlightIds: () => flightLayer?.getFlightIds() ?? [],
    getCameraHeight: () => globe.viewer.camera.positionCartographic?.height ?? 0,
  };

  if (typeof window !== 'undefined') {
    window.__gev = bus;
  }

  return bus;
}
