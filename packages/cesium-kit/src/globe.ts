import {
  type Cartesian2,
  Cartesian3,
  Credit,
  type Entity,
  Ion,
  OpenStreetMapImageryProvider,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from 'cesium';

export interface GlobeOptions {
  container: HTMLElement | string;
  enableDebugBus?: boolean;
  onEntitySelected?: (entity: Entity | null) => void;
}

export interface CameraPoseInput {
  longitude: number;
  latitude: number;
  altitude: number;
  heading?: number;
  pitch?: number;
  roll?: number;
}

/**
 * Keyless Cesium Globe Controller (Rule 1 & Rule 3)
 * Initializes a 3D globe with ion-free OpenStreetMap raster imagery.
 */
export class GlobeController {
  public readonly viewer: Viewer;
  private readonly eventHandler: ScreenSpaceEventHandler | null = null;
  private selectedEntity: Entity | null = null;
  public onEntitySelected?: (entity: Entity | null) => void;

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

    this.onEntitySelected = options.onEntitySelected;

    // Attach click handler for entity picking
    if (typeof window !== 'undefined' && this.viewer.scene && this.viewer.scene.canvas) {
      this.eventHandler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
      this.eventHandler.setInputAction((click: { position: Cartesian2 }) => {
        const pickedObject = this.viewer.scene.pick(click.position);
        if (pickedObject?.id) {
          this.selectedEntity = pickedObject.id as Entity;
          this.onEntitySelected?.(this.selectedEntity);
        } else {
          this.selectedEntity = null;
          this.onEntitySelected?.(null);
        }
      }, ScreenSpaceEventType.LEFT_CLICK);
    }
  }

  /**
   * Sets the camera pose from standard geographic coordinates and degrees.
   */
  setCameraPose(pose: CameraPoseInput): void {
    const rad = (deg: number) => (deg * Math.PI) / 180;
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(pose.longitude, pose.latitude, pose.altitude),
      orientation: {
        heading: rad(pose.heading ?? 0),
        pitch: rad(pose.pitch ?? -90),
        roll: rad(pose.roll ?? 0),
      },
    });
  }

  /**
   * Smoothly animates camera to target geographic location (Voice / Tool actuator).
   */
  flyToLocation(lat: number, lon: number, altitude_m = 500000, duration_s = 2): void {
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(lon, lat, altitude_m),
      duration: duration_s,
    });
  }

  /**
   * Returns currently selected entity if any.
   */
  getSelectedEntity(): Entity | null {
    return this.selectedEntity;
  }

  /**
   * Selects an entity programmatically.
   */
  selectEntity(entity: Entity | null): void {
    this.selectedEntity = entity;
    this.onEntitySelected?.(entity);
  }

  /**
   * Destroys the Cesium viewer and releases WebGL context.
   */
  destroy(): void {
    if (this.eventHandler && !this.eventHandler.isDestroyed()) {
      this.eventHandler.destroy();
    }
    if (!this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }
  }
}
