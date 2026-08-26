import type { RadioCatalog, RadioStation } from '@gev/contracts';
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

export interface RadioLayerOptions {
  viewer: Viewer;
  clock?: SimClock;
  dataSourceName?: string;
}

/**
 * Global Radio & ATC Broadcast Layer Controller (PLAN.md §8 Layer 7)
 * Renders radio transmission towers with Cyan/Lime (#06b6d4) styling.
 */
export class RadioLayerController {
  public readonly dataSource: CustomDataSource;
  public readonly clock: SimClock;
  private readonly viewer: Viewer;
  private readonly entityMap = new Map<string, Entity>();
  private pendingUpdates: RadioStation[] = [];
  private categoryFilter = 'all';
  private rafHandle: number | null = null;
  private isDestroyed = false;

  private static readonly CYAN_STREAM = Color.fromCssColorString('#06b6d4');
  private static readonly OUTLINE_COLOR = Color.fromCssColorString('#083344');

  constructor(options: RadioLayerOptions) {
    this.viewer = options.viewer;
    this.clock = options.clock ?? new SystemClock();
    this.dataSource = new CustomDataSource(options.dataSourceName ?? 'gev-radio');
    this.viewer.dataSources.add(this.dataSource);
  }

  /**
   * Enqueues a radio station catalog for the next rAF drain cycle.
   */
  enqueueCatalog(catalog: RadioCatalog): void {
    if (this.isDestroyed) return;

    this.pendingUpdates.push(...catalog.stations);
    this.scheduleRafDrain();
  }

  /**
   * Sets category filter ('all', 'atc', 'marine', 'emergency', 'broadcast').
   */
  setCategoryFilter(category: string): void {
    this.categoryFilter = category.toLowerCase();
    this.applyVisibilityFilters();
  }

  /**
   * Toggles visibility of the entire radio layer.
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
      const isVisible =
        this.categoryFilter === 'all' || station.category.toLowerCase() === this.categoryFilter;

      let entity = this.entityMap.get(id);

      if (!entity) {
        entity = this.dataSource.entities.add({
          id: `radio-${id}`,
          name: station.name,
          show: isVisible,
          position,
          point: {
            pixelSize: 8,
            color: RadioLayerController.CYAN_STREAM,
            outlineColor: RadioLayerController.OUTLINE_COLOR,
            outlineWidth: 1.5,
            scaleByDistance: new NearFarScalar(1.5e2, 1.6, 8.0e6, 0.6),
          },
          properties: {
            kind: 'radio',
            ...station,
          },
        });
        this.entityMap.set(id, entity);
      } else {
        entity.position = new ConstantPositionProperty(position);
        entity.show = isVisible;
        if (entity.properties) {
          entity.properties.merge({
            kind: 'radio',
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
      const cat = entity.properties?.getValue(jd)?.category ?? '';
      const isMatch =
        this.categoryFilter === 'all' || String(cat).toLowerCase() === this.categoryFilter;
      entity.show = isMatch;
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
