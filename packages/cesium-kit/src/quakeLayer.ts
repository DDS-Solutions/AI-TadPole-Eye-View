import type { EarthquakeCollection, EarthquakeFeature } from '@gev/contracts';
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

export interface QuakeLayerOptions {
  viewer: Viewer;
  clock?: SimClock;
  dataSourceName?: string;
  minMagnitude?: number;
}

/**
 * USGS Earthquakes Layer Controller (PLAN.md §8 Layer 3 & DESIGN.md §2.2)
 * Renders Seismic telemetry with Amber Orange (#fb923c) magnitude-scaled primitives.
 * Drains incoming collections through requestAnimationFrame queue straight into Cesium.
 */
export class QuakeLayerController {
  public readonly dataSource: CustomDataSource;
  public readonly clock: SimClock;
  private readonly viewer: Viewer;
  private readonly entityMap = new Map<string, Entity>();
  private pendingUpdates: EarthquakeFeature[] = [];
  private minMagnitude: number;
  private rafHandle: number | null = null;
  private isDestroyed = false;

  private static readonly AMBER_ORANGE = Color.fromCssColorString('#fb923c');
  private static readonly OUTLINE_COLOR = Color.fromCssColorString('#451a03');

  constructor(options: QuakeLayerOptions) {
    this.viewer = options.viewer;
    this.clock = options.clock ?? new SystemClock();
    this.minMagnitude = options.minMagnitude ?? 0;
    this.dataSource = new CustomDataSource(options.dataSourceName ?? 'gev-quakes');
    this.viewer.dataSources.add(this.dataSource);
  }

  /**
   * Enqueues an earthquake collection for the next rAF drain cycle.
   */
  enqueueCollection(collection: EarthquakeCollection): void {
    if (this.isDestroyed) return;

    this.pendingUpdates.push(...collection.features);
    this.scheduleRafDrain();
  }

  /**
   * Sets minimum magnitude filter (e.g. 2.5, 4.5).
   */
  setMinMagnitude(minMag: number): void {
    this.minMagnitude = minMag;
    this.applyVisibilityFilters();
  }

  /**
   * Toggles visibility of the entire earthquakes layer.
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
      const quake = updates[i];
      if (!quake || quake.longitude === null || quake.latitude === null) {
        continue;
      }

      const id = quake.id;
      const position = Cartesian3.fromDegrees(quake.longitude, quake.latitude, 0);
      const isVisible = quake.mag >= this.minMagnitude;

      // Magnitude-scaled pixel size (e.g. M2 -> 6px, M5 -> 15px, M8 -> 24px)
      const pixelSize = Math.max(6, Math.min(30, quake.mag * 3.5));

      let entity = this.entityMap.get(id);

      if (!entity) {
        entity = this.dataSource.entities.add({
          id: `quake-${id}`,
          name: `M${quake.mag.toFixed(1)} - ${quake.place}`,
          show: isVisible,
          position,
          point: {
            pixelSize,
            color: QuakeLayerController.AMBER_ORANGE,
            outlineColor: QuakeLayerController.OUTLINE_COLOR,
            outlineWidth: 1.5,
            scaleByDistance: new NearFarScalar(1.5e2, 1.8, 8.0e6, 0.7),
          },
          properties: {
            kind: 'quake',
            ...quake,
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
            kind: 'quake',
            ...quake,
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
      const mag = entity.properties?.getValue(jd)?.mag ?? 0;
      entity.show = Number(mag) >= this.minMagnitude;
    }
    this.dataSource.entities.resumeEvents();
  }

  getEntityCount(): number {
    return this.entityMap.size;
  }

  getQuakeIds(): string[] {
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
