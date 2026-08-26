import type { ShipBatch, ShipState } from '@gev/contracts';
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

export interface MarineLayerOptions {
  viewer: Viewer;
  clock?: SimClock;
  dataSourceName?: string;
}

/**
 * Maritime AIS Layer Controller (PLAN.md §8 Layer 2 & DESIGN.md §2.2)
 * Renders AIS vessel vectors with Emerald Teal (#2dd4bf) styling.
 * Drains incoming position batches through requestAnimationFrame queue straight into Cesium.
 */
export class MarineLayerController {
  public readonly dataSource: CustomDataSource;
  public readonly clock: SimClock;
  private readonly viewer: Viewer;
  private readonly entityMap = new Map<string, Entity>();
  private pendingUpdates: ShipState[] = [];
  private vesselTypeFilter = 'all';
  private rafHandle: number | null = null;
  private isDestroyed = false;

  private static readonly EMERALD_TEAL = Color.fromCssColorString('#2dd4bf');
  private static readonly OUTLINE_COLOR = Color.fromCssColorString('#0f172a');

  constructor(options: MarineLayerOptions) {
    this.viewer = options.viewer;
    this.clock = options.clock ?? new SystemClock();
    this.dataSource = new CustomDataSource(options.dataSourceName ?? 'gev-marine');
    this.viewer.dataSources.add(this.dataSource);
  }

  /**
   * Enqueues a batch of AIS vessel updates for the next rAF drain cycle.
   */
  enqueueBatch(batch: ShipBatch): void {
    if (this.isDestroyed) return;

    this.pendingUpdates.push(...batch.ships);
    this.scheduleRafDrain();
  }

  /**
   * Sets vessel type filter (e.g. 'all', 'Cargo', 'Tanker', 'Passenger', 'Fishing').
   */
  setVesselTypeFilter(vesselType: string): void {
    this.vesselTypeFilter = vesselType.toLowerCase();
    this.applyVisibilityFilters();
  }

  /**
   * Toggles visibility of the entire marine layer.
   */
  setVisible(visible: boolean): void {
    this.dataSource.show = visible;
  }

  /**
   * Schedules a single rAF drain if not already pending.
   */
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

  /**
   * Drains all pending ship updates into Cesium entities in a single frame.
   */
  private drainQueue(): void {
    if (this.pendingUpdates.length === 0 || this.isDestroyed) return;

    const updates = this.pendingUpdates;
    this.pendingUpdates = [];

    this.dataSource.entities.suspendEvents();

    for (let i = 0; i < updates.length; i++) {
      const ship = updates[i];
      if (!ship || ship.longitude === null || ship.latitude === null) {
        continue;
      }

      const id = ship.mmsi;
      // AIS sea surface position (altitude = 0m)
      const position = Cartesian3.fromDegrees(ship.longitude, ship.latitude, 0);
      const isVisible =
        this.vesselTypeFilter === 'all' ||
        ship.ship_type.toLowerCase().includes(this.vesselTypeFilter);

      let entity = this.entityMap.get(id);

      if (!entity) {
        entity = this.dataSource.entities.add({
          id: `ship-${id}`,
          name: ship.name || `MMSI ${ship.mmsi}`,
          show: isVisible,
          position,
          point: {
            pixelSize: 7,
            color: MarineLayerController.EMERALD_TEAL,
            outlineColor: MarineLayerController.OUTLINE_COLOR,
            outlineWidth: 1.5,
            scaleByDistance: new NearFarScalar(1.5e2, 1.6, 8.0e6, 0.6),
          },
          properties: {
            kind: 'marine',
            ...ship,
          },
        });
        this.entityMap.set(id, entity);
      } else {
        entity.position = new ConstantPositionProperty(position);
        entity.show = isVisible;
        if (entity.properties) {
          entity.properties.merge({
            kind: 'marine',
            ...ship,
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
      const shipType = entity.properties?.getValue(jd)?.ship_type ?? '';
      const isMatch =
        this.vesselTypeFilter === 'all' ||
        String(shipType).toLowerCase().includes(this.vesselTypeFilter);
      entity.show = isMatch;
    }
    this.dataSource.entities.resumeEvents();
  }

  /**
   * Gets current active entity count.
   */
  getEntityCount(): number {
    return this.entityMap.size;
  }

  /**
   * Gets all active vessel MMSIs.
   */
  getShipIds(): string[] {
    return Array.from(this.entityMap.keys());
  }

  /**
   * Destroys the layer and removes entities.
   */
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
