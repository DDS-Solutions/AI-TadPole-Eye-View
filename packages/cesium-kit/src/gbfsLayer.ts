import type { BikeStation, BikeStationBatch } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  CustomDataSource,
  type Entity,
  JulianDate,
  NearFarScalar,
  type Viewer,
} from 'cesium';

export interface GbfsLayerOptions {
  viewer: Viewer;
  clock?: SimClock;
  dataSourceName?: string;
  minBikesAvailable?: number;
}

/**
 * GBFS Bikeshare Transit Layer Controller (PLAN.md §8 Layer 5 & DESIGN.md §2.2)
 * Renders Urban Mobility telemetry with Indigo Violet (#818cf8) station capacity visualizers.
 * Drains incoming batches through requestAnimationFrame queue straight into Cesium.
 */
export class GbfsLayerController {
  public readonly dataSource: CustomDataSource;
  public readonly clock: SimClock;
  private readonly viewer: Viewer;
  private readonly entityMap = new Map<string, Entity>();
  private pendingUpdates: BikeStation[] = [];
  private minBikesAvailable: number;
  private rafHandle: number | null = null;
  private isDestroyed = false;

  private static readonly INDIGO_VIOLET = Color.fromCssColorString('#818cf8');
  private static readonly OUTLINE_COLOR = Color.fromCssColorString('#1e1b4b');

  constructor(options: GbfsLayerOptions) {
    this.viewer = options.viewer;
    this.clock = options.clock ?? new SystemClock();
    this.minBikesAvailable = options.minBikesAvailable ?? 0;
    this.dataSource = new CustomDataSource(options.dataSourceName ?? 'gev-gbfs');
    this.viewer.dataSources.add(this.dataSource);
  }

  /**
   * Enqueues a bikeshare station batch for the next rAF drain cycle.
   */
  enqueueBatch(batch: BikeStationBatch): void {
    if (this.isDestroyed) return;

    this.pendingUpdates.push(...batch.stations);
    this.scheduleRafDrain();
  }

  /**
   * Sets minimum available bikes filter.
   */
  setMinBikesAvailable(minBikes: number): void {
    this.minBikesAvailable = minBikes;
    this.applyVisibilityFilters();
  }

  /**
   * Toggles visibility of the entire GBFS layer.
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

      const id = station.station_id;
      const position = Cartesian3.fromDegrees(station.longitude, station.latitude, 0);
      const isVisible = station.num_bikes_available >= this.minBikesAvailable;

      // Sizing based on capacity
      const pixelSize = Math.max(6, Math.min(20, 6 + Math.sqrt(station.capacity) * 2));

      let entity = this.entityMap.get(id);

      if (!entity) {
        entity = this.dataSource.entities.add({
          id: `gbfs-${id}`,
          name: station.name,
          show: isVisible,
          position,
          point: {
            pixelSize,
            color: GbfsLayerController.INDIGO_VIOLET,
            outlineColor: GbfsLayerController.OUTLINE_COLOR,
            outlineWidth: 1.5,
            scaleByDistance: new NearFarScalar(1.5e2, 1.8, 8.0e6, 0.5),
          },
          properties: {
            kind: 'gbfs',
            ...station,
          },
        });
        this.entityMap.set(id, entity);
      } else {
        entity.position = new ConstantPositionProperty(position);
        entity.show = isVisible;
        if (entity.point) {
          entity.point.pixelSize = pixelSize as unknown as undefined;
        }
        if (entity.properties) {
          entity.properties.merge({
            kind: 'gbfs',
            ...station,
          });
        }
      }
    }

    this.dataSource.entities.resumeEvents();
  }

  private applyVisibilityFilters(): void {
    this.dataSource.entities.suspendEvents();
    const jd = JulianDate.fromDate(new Date(this.clock.now()));
    for (const [, entity] of this.entityMap) {
      const props = entity.properties?.getValue(jd);
      const bikes = Number(props?.num_bikes_available ?? 0);
      entity.show = bikes >= this.minBikesAvailable;
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
