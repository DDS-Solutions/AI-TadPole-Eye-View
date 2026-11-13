import type { ShipBatch, ShipState } from '@gev/contracts';
import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  JulianDate,
  NearFarScalar,
} from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

export interface MarineLayerOptions extends BaseLayerOptions {}

/**
 * Maritime AIS Layer Controller (PLAN.md §8 Layer 2 & DESIGN.md §2.2)
 * Renders AIS vessel vectors with the maritime design channel.
 * Drains incoming position batches through requestAnimationFrame queue straight into Cesium.
 */
const ACTIVE_MARINE_ALPHA = 1.0;
const STALE_MARINE_ALPHA = 0.42;

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
      const alpha = this.isSignalLost ? STALE_MARINE_ALPHA : ACTIVE_MARINE_ALPHA;
      entity = this.dataSource.entities.add({
        id: `ship-${id}`,
        name: ship.name || `MMSI ${ship.mmsi}`,
        show: isVisible,
        position,
        point: {
          pixelSize: 7,
          color: MarineLayerController.EMERALD_TEAL.withAlpha(alpha),
          outlineColor: MarineLayerController.OUTLINE_COLOR.withAlpha(alpha),
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

  protected override onSignalLostChanged(lost: boolean): void {
    const alpha = lost ? STALE_MARINE_ALPHA : ACTIVE_MARINE_ALPHA;
    const fill = MarineLayerController.EMERALD_TEAL.withAlpha(alpha);
    const outline = MarineLayerController.OUTLINE_COLOR.withAlpha(alpha);
    this.dataSource.entities.suspendEvents();
    for (const entity of this.entityMap.values()) {
      if (entity.point) {
        entity.point.color = new ConstantProperty(fill);
        entity.point.outlineColor = new ConstantProperty(outline);
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
   * Gets all active vessel MMSIs.
   */
  getShipIds(): string[] {
    return this.getEntityIds();
  }
}
