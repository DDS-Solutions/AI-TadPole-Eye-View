import type { CctvCamera, CctvCatalog } from '@gev/contracts';
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

export interface CctvLayerOptions {
  viewer: Viewer;
  clock?: SimClock;
  dataSourceName?: string;
}

/**
 * Public CCTV & Traffic Camera Layer Controller (PLAN.md §8 Layer 6)
 * Renders verified DOT traffic cameras with Purple/Violet (#a855f7) styling.
 */
export class CctvLayerController {
  public readonly dataSource: CustomDataSource;
  public readonly clock: SimClock;
  private readonly viewer: Viewer;
  private readonly entityMap = new Map<string, Entity>();
  private pendingUpdates: CctvCamera[] = [];
  private agencyFilter = 'all';
  private rafHandle: number | null = null;
  private isDestroyed = false;

  private static readonly PURPLE_VIOLET = Color.fromCssColorString('#a855f7');
  private static readonly OUTLINE_COLOR = Color.fromCssColorString('#3b0764');

  constructor(options: CctvLayerOptions) {
    this.viewer = options.viewer;
    this.clock = options.clock ?? new SystemClock();
    this.dataSource = new CustomDataSource(options.dataSourceName ?? 'gev-cctv');
    this.viewer.dataSources.add(this.dataSource);
  }

  /**
   * Enqueues a CCTV camera catalog for the next rAF drain cycle.
   */
  enqueueCatalog(catalog: CctvCatalog): void {
    if (this.isDestroyed) return;

    this.pendingUpdates.push(...catalog.cameras);
    this.scheduleRafDrain();
  }

  /**
   * Sets agency filter (e.g. 'all', 'caltrans', 'nycdot', 'tfl').
   */
  setAgencyFilter(agency: string): void {
    this.agencyFilter = agency.toLowerCase();
    this.applyVisibilityFilters();
  }

  /**
   * Toggles visibility of the entire CCTV layer.
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
      const cam = updates[i];
      if (!cam || cam.longitude === null || cam.latitude === null) {
        continue;
      }

      const id = cam.id;
      const position = Cartesian3.fromDegrees(cam.longitude, cam.latitude, 0);
      const isVisible =
        this.agencyFilter === 'all' || cam.agency.toLowerCase().includes(this.agencyFilter);

      let entity = this.entityMap.get(id);

      if (!entity) {
        entity = this.dataSource.entities.add({
          id: `cctv-${id}`,
          name: cam.name,
          show: isVisible,
          position,
          point: {
            pixelSize: 8,
            color: CctvLayerController.PURPLE_VIOLET,
            outlineColor: CctvLayerController.OUTLINE_COLOR,
            outlineWidth: 1.5,
            scaleByDistance: new NearFarScalar(1.5e2, 1.6, 8.0e6, 0.6),
          },
          properties: {
            kind: 'cctv',
            ...cam,
          },
        });
        this.entityMap.set(id, entity);
      } else {
        entity.position = new ConstantPositionProperty(position);
        entity.show = isVisible;
        if (entity.properties) {
          entity.properties.merge({
            kind: 'cctv',
            ...cam,
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
      const agency = entity.properties?.getValue(jd)?.agency ?? '';
      const isMatch =
        this.agencyFilter === 'all' || String(agency).toLowerCase().includes(this.agencyFilter);
      entity.show = isMatch;
    }
    this.dataSource.entities.resumeEvents();
  }

  getEntityCount(): number {
    return this.entityMap.size;
  }

  getCameraIds(): string[] {
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
