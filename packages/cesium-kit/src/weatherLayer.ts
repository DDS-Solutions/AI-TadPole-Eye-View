import type { WeatherCollection, WeatherStation } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  CustomDataSource,
  type Entity,
  NearFarScalar,
  type Viewer,
} from 'cesium';

export interface WeatherLayerOptions {
  viewer: Viewer;
  clock?: SimClock;
  dataSourceName?: string;
  enableRadarImagery?: boolean;
}

/**
 * Weather Radar & Meteorological Observations Layer Controller (PLAN.md §8 Layer 9)
 * Renders meteorological observations with Sky Blue (#60a5fa) styling.
 */
export class WeatherLayerController {
  public readonly dataSource: CustomDataSource;
  public readonly clock: SimClock;
  private readonly viewer: Viewer;
  private readonly entityMap = new Map<string, Entity>();
  private pendingUpdates: WeatherStation[] = [];
  public radarTileTemplate?: string;
  private rafHandle: number | null = null;
  private isDestroyed = false;

  private static readonly SKY_BLUE = Color.fromCssColorString('#60a5fa');
  private static readonly OUTLINE_COLOR = Color.fromCssColorString('#1e3a8a');

  constructor(options: WeatherLayerOptions) {
    this.viewer = options.viewer;
    this.clock = options.clock ?? new SystemClock();
    this.dataSource = new CustomDataSource(options.dataSourceName ?? 'gev-weather');
    this.viewer.dataSources.add(this.dataSource);
  }

  /**
   * Enqueues a weather collection for the next rAF drain cycle.
   */
  enqueueWeather(weather: WeatherCollection): void {
    if (this.isDestroyed) return;

    this.pendingUpdates.push(...weather.stations);
    this.radarTileTemplate = weather.radar_tile_template;
    this.scheduleRafDrain();
  }

  /**
   * Toggles visibility of the entire weather layer.
   */
  setVisible(visible: boolean): void {
    this.dataSource.show = visible;
  }

  private scheduleRafDrain(): void {
    if (this.rafHandle !== null || typeof requestAnimationFrame !== 'function') {
      if (typeof requestAnimationFrame !== 'function') {
        this.drainQueue();
      }
      return;
    }

    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    if (this.pendingUpdates.length === 0 || this.isDestroyed) return;

    const updates = this.pendingUpdates;
    this.pendingUpdates = [];

    this.dataSource.entities.suspendEvents();

    for (let i = 0; i < updates.length; i++) {
      const station = updates[i];
      if (!station || station.longitude === null || station.latitude === null) {
        continue;
      }

      const id = station.id;
      const position = Cartesian3.fromDegrees(station.longitude, station.latitude, 0);

      let entity = this.entityMap.get(id);

      if (!entity) {
        entity = this.dataSource.entities.add({
          id: `weather-${id}`,
          name: `${station.name} (${station.temp_c}°C, ${station.condition})`,
          position,
          point: {
            pixelSize: 8,
            color: WeatherLayerController.SKY_BLUE,
            outlineColor: WeatherLayerController.OUTLINE_COLOR,
            outlineWidth: 1.5,
            scaleByDistance: new NearFarScalar(1.5e2, 1.6, 8.0e6, 0.6),
          },
          properties: {
            kind: 'weather',
            ...station,
          },
        });
        this.entityMap.set(id, entity);
      } else {
        entity.position = new ConstantPositionProperty(position);
        if (entity.properties) {
          entity.properties.merge({
            kind: 'weather',
            ...station,
          });
        }
      }
    }

    this.dataSource.entities.resumeEvents();
  }

  getEntityCount(): number {
    return this.entityMap.size;
  }

  getStationIds(): string[] {
    return Array.from(this.entityMap.keys());
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.rafHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.viewer.dataSources.remove(this.dataSource, true);
    this.entityMap.clear();
    this.pendingUpdates = [];
  }
}
