import type { FlightBatch, FlightState } from '@gev/contracts';
import { Cartesian3, Color, ConstantPositionProperty, NearFarScalar } from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';

export interface FlightLayerOptions extends BaseLayerOptions {}

/**
 * Flight Layer Controller (Rule 1 & Rule 5)
 * Drains incoming position batches through requestAnimationFrame queue straight into Cesium.
 */
export class FlightLayerController extends BaseLayerController<FlightState, FlightLayerOptions> {
  constructor(options: FlightLayerOptions) {
    super(options, 'gev-flights');
  }

  /**
   * Enqueues a batch of flight updates for the next rAF drain cycle.
   */
  enqueueBatch(batch: FlightBatch): void {
    this.enqueueUpdates(batch.states);
  }

  protected getEntityId(flight: FlightState): string {
    return flight.icao24;
  }

  protected processEntity(flight: FlightState, id: string): void {
    if (flight.longitude === null || flight.latitude === null) {
      return;
    }

    const altitude = flight.geo_altitude ?? flight.baro_altitude ?? 0;
    const position = Cartesian3.fromDegrees(flight.longitude, flight.latitude, altitude);

    let entity = this.entityMap.get(id);

    if (!entity) {
      entity = this.dataSource.entities.add({
        id: `flight-${id}`,
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

  /**
   * Gets all active aircraft IDs.
   */
  getFlightIds(): string[] {
    return this.getEntityIds();
  }
}
