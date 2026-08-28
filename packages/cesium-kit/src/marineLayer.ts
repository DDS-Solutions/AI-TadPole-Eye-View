import type { ShipBatch, ShipState } from '@gev/contracts';
import { Cartesian3, Color, ConstantPositionProperty, JulianDate, NearFarScalar } from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

export interface MarineLayerOptions extends BaseLayerOptions {}

/**
 * Maritime AIS Layer Controller (PLAN.md §8 Layer 2 & DESIGN.md §2.2)
 * Renders AIS vessel vectors with the maritime design channel.
 * Drains incoming position batches through requestAnimationFrame queue straight into Cesium.
 */
export class MarineLayerController extends BaseLayerController<ShipState, MarineLayerOptions> {
  private vesselTypeFilter = 'all';

  private static readonly EMERALD_TEAL = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.channels.maritime
  );
  private static readonly OUTLINE_COLOR = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.outlines.maritime
  );

  constructor(options: MarineLayerOptions) {
    super(options, 'gev-marine');
  }

  /**
   * Enqueues a batch of AIS vessel updates for the next rAF drain cycle.
   */
  enqueueBatch(batch: ShipBatch): void {
    this.enqueueUpdates(batch.ships);
  }

  /**
   * Sets vessel type filter (e.g. 'all', 'Cargo', 'Tanker', 'Passenger', 'Fishing').
   */
  setVesselTypeFilter(vesselType: string): void {
    this.vesselTypeFilter = vesselType.toLowerCase();
    this.applyVisibilityFilters();
  }

  protected getEntityId(ship: ShipState): string {
    return ship.mmsi;
  }

  protected processEntity(ship: ShipState, id: string): void {
    if (ship.longitude === null || ship.latitude === null) {
      return;
    }

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
   * Gets all active vessel MMSIs.
   */
  getShipIds(): string[] {
    return this.getEntityIds();
  }
}
