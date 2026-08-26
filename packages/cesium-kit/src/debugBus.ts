import type { FlightLayerController } from './flightLayer.js';
import type { GlobeController } from './globe.js';

export interface CameraPose {
  longitude: number;
  latitude: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
}

export interface GevDebugBus {
  version: 1;
  isReady: () => boolean;
  getEntityCount: () => number;
  getFlightIds: () => string[];
  getCameraHeight: () => number;
  getCameraPose: () => CameraPose;
}

declare global {
  interface Window {
    __gev?: GevDebugBus;
  }
}

/**
 * Attaches the window.__gev debug bus for E2E condition-wait assertions and operator introspection.
 */
export function attachDebugBus(
  globe: GlobeController,
  flightLayer?: FlightLayerController
): GevDebugBus {
  const bus: GevDebugBus = {
    version: 1,
    isReady: () => !globe.viewer.isDestroyed(),
    getEntityCount: () => flightLayer?.getEntityCount() ?? 0,
    getFlightIds: () => flightLayer?.getFlightIds() ?? [],
    getCameraHeight: () => globe.viewer.camera.positionCartographic?.height ?? 0,
    getCameraPose: () => {
      const carto = globe.viewer.camera.positionCartographic;
      const deg = (rad: number) => (rad * 180) / Math.PI;
      return {
        longitude: carto ? deg(carto.longitude) : 0,
        latitude: carto ? deg(carto.latitude) : 0,
        altitude: carto?.height ?? 0,
        heading: deg(globe.viewer.camera.heading),
        pitch: deg(globe.viewer.camera.pitch),
        roll: deg(globe.viewer.camera.roll),
      };
    },
  };

  if (typeof window !== 'undefined') {
    window.__gev = bus;
  }

  return bus;
}
