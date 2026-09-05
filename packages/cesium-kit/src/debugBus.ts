import type { CableLayerController } from './cableLayer.js';
import type { CctvLayerController } from './cctvLayer.js';
import type { FirmsLayerController } from './firmsLayer.js';
import type { FlightLayerController } from './flightLayer.js';
import type { GbfsLayerController } from './gbfsLayer.js';
import type { GlobeController } from './globe.js';
import type { LaunchLayerController } from './launchLayer.js';
import type { MarineLayerController } from './marineLayer.js';
import type { QuakeLayerController } from './quakeLayer.js';
import type { RadioLayerController } from './radioLayer.js';
import type { SatelliteLayerController } from './satelliteLayer.js';
import type { WeatherLayerController } from './weatherLayer.js';

import type { FrameBudgetMonitor, FrameBudgetReport, FrameMetrics } from './frameBudget.js';

export interface CameraPose {
  longitude: number;
  latitude: number;
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
}

export interface LayerControllersMap {
  flight?: FlightLayerController;
  marine?: MarineLayerController;
  quakes?: QuakeLayerController;
  firms?: FirmsLayerController;
  gbfs?: GbfsLayerController;
  cctv?: CctvLayerController;
  radio?: RadioLayerController;
  launches?: LaunchLayerController;
  weather?: WeatherLayerController;
  cables?: CableLayerController;
  satellites?: SatelliteLayerController;
}

export interface GevDebugBus {
  version: 1;
  isReady: () => boolean;
  getEntityCount: () => number;
  getLayerCounts: () => Record<string, number>;
  getFlightIds: () => string[];
  getShipIds: () => string[];
  getQuakeIds: () => string[];
  getHotspotIds: () => string[];
  getStationIds: () => string[];
  getCameraIds: () => string[];
  getRadioStationIds: () => string[];
  getMissionIds: () => string[];
  getWeatherStationIds: () => string[];
  getCableRouteCount: () => number;
  getCableLandingPointCount: () => number;
  getSatelliteIds: () => string[];
  getCameraHeight: () => number;
  getCameraPose: () => CameraPose;
  getSelectedEntity: () => unknown;
  getFrameMetrics?: () => FrameMetrics | null;
  getFrameReport?: () => FrameBudgetReport | null;
}

declare global {
  interface Window {
    __gev?: GevDebugBus;
  }
}

export interface DebugBusOptions {
  /** If explicitly false, window.__gev will not be attached */
  attachToWindow?: boolean;
  /** Optional frame budget monitor instance to expose on the debug bus */
  frameMonitor?: FrameBudgetMonitor;
}

/**
 * Attaches the window.__gev debug bus for E2E condition-wait assertions and operator introspection.
 */
export function attachDebugBus(
  globe: GlobeController,
  layersOrFlightLayer?: FlightLayerController | LayerControllersMap,
  options: DebugBusOptions = {}
): GevDebugBus {
  const layers: LayerControllersMap =
    layersOrFlightLayer && 'dataSource' in layersOrFlightLayer
      ? { flight: layersOrFlightLayer as FlightLayerController }
      : ((layersOrFlightLayer as LayerControllersMap) ?? {});

  const frameMonitor = options.frameMonitor;

  const bus: GevDebugBus = {
    version: 1,
    isReady: () => !globe.viewer.isDestroyed(),
    getEntityCount: () => {
      const flightCount = layers.flight?.getEntityCount() ?? 0;
      const marineCount = layers.marine?.getEntityCount() ?? 0;
      const quakesCount = layers.quakes?.getEntityCount() ?? 0;
      const firmsCount = layers.firms?.getEntityCount() ?? 0;
      const gbfsCount = layers.gbfs?.getEntityCount() ?? 0;
      const cctvCount = layers.cctv?.getEntityCount() ?? 0;
      const radioCount = layers.radio?.getEntityCount() ?? 0;
      const launchCount = layers.launches?.getEntityCount() ?? 0;
      const weatherCount = layers.weather?.getEntityCount() ?? 0;
      const cableCount = layers.cables?.getEntityCount() ?? 0;
      const satelliteCount = layers.satellites?.getEntityCount() ?? 0;
      return (
        flightCount +
        marineCount +
        quakesCount +
        firmsCount +
        gbfsCount +
        cctvCount +
        radioCount +
        launchCount +
        weatherCount +
        cableCount +
        satelliteCount
      );
    },
    getLayerCounts: () => {
      return {
        flights: layers.flight?.getEntityCount() ?? 0,
        marine: layers.marine?.getEntityCount() ?? 0,
        quakes: layers.quakes?.getEntityCount() ?? 0,
        firms: layers.firms?.getEntityCount() ?? 0,
        gbfs: layers.gbfs?.getEntityCount() ?? 0,
        cctv: layers.cctv?.getEntityCount() ?? 0,
        radio: layers.radio?.getEntityCount() ?? 0,
        launches: layers.launches?.getEntityCount() ?? 0,
        weather: layers.weather?.getEntityCount() ?? 0,
        cables: layers.cables?.getEntityCount() ?? 0,
        satellites: layers.satellites?.getEntityCount() ?? 0,
      };
    },
    getFlightIds: () => layers.flight?.getFlightIds() ?? [],
    getShipIds: () => layers.marine?.getShipIds() ?? [],
    getQuakeIds: () => layers.quakes?.getQuakeIds() ?? [],
    getHotspotIds: () => layers.firms?.getHotspotIds() ?? [],
    getStationIds: () => layers.gbfs?.getStationIds() ?? [],
    getCameraIds: () => layers.cctv?.getCameraIds() ?? [],
    getRadioStationIds: () => layers.radio?.getStationIds() ?? [],
    getMissionIds: () => layers.launches?.getMissionIds() ?? [],
    getWeatherStationIds: () => layers.weather?.getStationIds() ?? [],
    getCableRouteCount: () => layers.cables?.getRouteCount() ?? 0,
    getCableLandingPointCount: () => layers.cables?.getLandingPointCount() ?? 0,
    getSatelliteIds: () => layers.satellites?.getSatelliteIds() ?? [],
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
    getSelectedEntity: () => globe.getSelectedEntity(),
    getFrameMetrics: () => frameMonitor?.getMetrics() ?? null,
    getFrameReport: () => frameMonitor?.getReport() ?? null,
  };

  const shouldAttach =
    options.attachToWindow ??
    (typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.search.includes('gev_debug=1')));

  if (typeof window !== 'undefined' && shouldAttach) {
    window.__gev = bus;
  }

  return bus;
}
