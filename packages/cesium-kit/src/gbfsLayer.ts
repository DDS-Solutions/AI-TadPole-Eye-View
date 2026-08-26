import type { BikeStation, BikeStationBatch } from '@gev/contracts';
import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  JulianDate,
  NearFarScalar,
} from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';

export interface GbfsLayerOptions extends BaseLayerOptions {
  minBikesAvailable?: number;
}

/**
 * GBFS Bikeshare Transit Layer Controller (PLAN.md §8 Layer 5 & DESIGN.md §2.2)
 * Renders Urban Mobility telemetry with Indigo Violet (#818cf8) station capacity visualizers.
 * Drains incoming batches through requestAnimationFrame queue straight into Cesium.
 */
export class GbfsLayerController extends BaseLayerController<BikeStation, GbfsLayerOptions> {
  private minBikesAvailable: number;

  private static readonly INDIGO_VIOLET = Color.fromCssColorString('#818cf8');
  private static readonly OUTLINE_COLOR = Color.fromCssColorString('#1e1b4b');

  constructor(options: GbfsLayerOptions) {
    super(options, 'gev-gbfs');
    this.minBikesAvailable = options.minBikesAvailable ?? 0;
  }

  /**
   * Enqueues a bikeshare station batch for the next rAF drain cycle.
   */
  enqueueBatch(batch: BikeStationBatch): void {
    this.enqueueUpdates(batch.stations);
  }

  /**
   * Sets minimum available bikes filter.
   */
  setMinBikesAvailable(minBikes: number): void {
    this.minBikesAvailable = minBikes;
    this.applyVisibilityFilters();
  }

  protected getEntityId(station: BikeStation): string {
    return station.station_id;
  }

  protected processEntity(station: BikeStation, id: string): void {
    if (station.longitude === null || station.latitude === null) {
      return;
    }

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
        entity.point.pixelSize = new ConstantProperty(pixelSize);
      }
      if (entity.properties) {
        entity.properties.merge({
          kind: 'gbfs',
          ...station,
        });
      }
    }
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

  /**
   * Gets all active station IDs.
   */
  getStationIds(): string[] {
    return this.getEntityIds();
  }
}
