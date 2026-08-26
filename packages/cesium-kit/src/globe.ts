import { Cartesian3, Credit, Ion, OpenStreetMapImageryProvider, Viewer } from 'cesium';

export interface GlobeOptions {
  container: HTMLElement | string;
  enableDebugBus?: boolean;
}

/**
 * Keyless Cesium Globe Controller (Rule 1 & Rule 3)
 * Initializes a 3D globe with ion-free OpenStreetMap raster imagery.
 */
export class GlobeController {
  public readonly viewer: Viewer;

  constructor(options: GlobeOptions) {
    // Rule 3: Explicitly keyless boot default
    Ion.defaultAccessToken = '';

    const element =
      typeof options.container === 'string'
        ? document.getElementById(options.container)
        : options.container;

    if (!element) {
      throw new Error(`Globe container element not found: ${options.container}`);
    }

    // Use keyless OpenStreetMap raster imagery provider
    const osmImagery = new OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
      credit: new Credit('© OpenStreetMap contributors', true),
    });

    this.viewer = new Viewer(element, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      animation: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      skyAtmosphere: false,
      shouldAnimate: true,
    });

    // Add keyless OSM baseline layer
    this.viewer.imageryLayers.addImageryProvider(osmImagery);

    // Initial default camera positioning (global view over Atlantic)
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(-30.0, 30.0, 20000000.0),
    });
  }

  /**
   * Destroys the Cesium viewer and releases WebGL context.
   */
  destroy(): void {
    if (!this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }
  }
}
