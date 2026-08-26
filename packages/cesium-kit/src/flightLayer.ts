import type { FlightBatch, FlightState } from '@gev/contracts';
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

export interface FlightLayerOptions {
  viewer: Viewer;
  clock?: SimClock;
  dataSourceName?: string;
}

/**
 * Flight Layer Controller (Rule 1 & Rule 5)
 * Drains incoming position batches through requestAnimationFrame queue straight into Cesium.
 */
export class FlightLayerController {
  public readonly dataSource: CustomDataSource;
  public readonly clock: SimClock;
  private readonly viewer: Viewer;
  private readonly entityMap = new Map<string, Entity>();
  private pendingUpdates: FlightState[] = [];
  private rafHandle: number | null = null;
  private isDestroyed = false;

  constructor(options: FlightLayerOptions) {
    this.viewer = options.viewer;
    this.clock = options.clock ?? new SystemClock();
    this.dataSource = new CustomDataSource(options.dataSourceName ?? 'gev-flights');
    this.viewer.dataSources.add(this.dataSource);
  }

  /**
   * Enqueues a batch of flight updates for the next rAF drain cycle.
   */
  enqueueBatch(batch: FlightBatch): void {
    if (this.isDestroyed) return;

    this.pendingUpdates.push(...batch.states);
    this.scheduleRafDrain();
  }

  /**
   * Schedules a single rAF drain if not already pending.
   */
  private scheduleRafDrain(): void {
    if (this.rafHandle !== null || typeof requestAnimationFrame !== 'function') {
      // Fallback for non-browser or test environments
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
   * Drains all pending flight updates into Cesium entities in a single frame.
   */
  private drainQueue(): void {
    if (this.pendingUpdates.length === 0 || this.isDestroyed) return;

    const updates = this.pendingUpdates;
    this.pendingUpdates = [];

    this.dataSource.entities.suspendEvents();

    for (let i = 0; i < updates.length; i++) {
      const flight = updates[i];
      if (!flight || flight.longitude === null || flight.latitude === null) {
        continue;
      }

      const id = flight.icao24;
      const altitude = flight.geo_altitude ?? flight.baro_altitude ?? 0;
      const position = Cartesian3.fromDegrees(flight.longitude, flight.latitude, altitude);

      let entity = this.entityMap.get(id);

      if (!entity) {
        entity = this.dataSource.entities.add({
          id,
          name: flight.callsign || flight.icao24,
          position,
          point: {
            pixelSize: 6,
            color: Color.CYAN,
            outlineColor: Color.BLACK,
            outlineWidth: 1,
            scaleByDistance: new NearFarScalar(1.5e2, 1.5, 8.0e6, 0.5),
          },
          properties: {
            ...flight,
          },
        });
        this.entityMap.set(id, entity);
      } else {
        entity.position = new ConstantPositionProperty(position);
        if (entity.properties) {
          entity.properties.merge(flight);
        }
      }
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
   * Gets all active aircraft IDs.
   */
  getFlightIds(): string[] {
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
