import type { ThermalHotspot, ThermalHotspotBatch } from '@gev/contracts';
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

export interface FirmsLayerOptions extends BaseLayerOptions {
  minFrp?: number;
  confidenceFilter?: string;
}

/**
 * NASA FIRMS Thermal Hotspots Layer Controller (PLAN.md §8 Layer 4 & DESIGN.md §2.2)
 * Renders thermal telemetry with the thermal design channel.
 * Drains incoming batches through requestAnimationFrame queue straight into Cesium.
 */
export class FirmsLayerController extends BaseLayerController<ThermalHotspot, FirmsLayerOptions> {
  private minFrp: number;
  private confidenceFilter: string;

  private static readonly ROSE_RED = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.channels.thermal
  );
  private static readonly OUTLINE_COLOR = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.outlines.thermal
  );

  constructor(options: FirmsLayerOptions) {
    super(options, 'gev-firms');
    this.minFrp = options.minFrp ?? 0;
    this.confidenceFilter = (options.confidenceFilter ?? 'all').toLowerCase();
  }

  /**
   * Enqueues a thermal hotspot batch for the next rAF drain cycle.
   */
  enqueueBatch(batch: ThermalHotspotBatch): void {
    this.enqueueUpdates(batch.hotspots);
  }

  /**
   * Sets minimum Fire Radiative Power (MW) filter.
   */
  setMinFrp(minFrp: number): void {
    this.minFrp = minFrp;
    this.applyVisibilityFilters();
  }

  /**
   * Sets detection confidence filter ('all', 'nominal', 'high').
   */
  setConfidenceFilter(confidence: string): void {
    this.confidenceFilter = confidence.toLowerCase();
    this.applyVisibilityFilters();
  }

  protected getEntityId(hotspot: ThermalHotspot): string {
    return hotspot.id;
  }

  protected processEntity(hotspot: ThermalHotspot, id: string): void {
    if (hotspot.longitude === null || hotspot.latitude === null) {
      return;
    }

    const position = Cartesian3.fromDegrees(hotspot.longitude, hotspot.latitude, 0);

    const matchesFrp = hotspot.frp_mw >= this.minFrp;
    const matchesConf =
      this.confidenceFilter === 'all' ||
      hotspot.confidence.toLowerCase().includes(this.confidenceFilter);
    const isVisible = matchesFrp && matchesConf;

    // Sizing based on FRP (MW)
    const pixelSize = Math.max(5, Math.min(22, 5 + Math.sqrt(hotspot.frp_mw) * 1.5));

    let entity = this.entityMap.get(id);

    if (!entity) {
      entity = this.dataSource.entities.add({
        id: `firms-${id}`,
        name: `Thermal Hotspot ${hotspot.satellite} (${hotspot.frp_mw.toFixed(1)} MW)`,
        show: isVisible,
        position,
        point: {
          pixelSize,
          color: FirmsLayerController.ROSE_RED,
          outlineColor: FirmsLayerController.OUTLINE_COLOR,
          outlineWidth: 1.5,
          scaleByDistance: new NearFarScalar(1.5e2, 1.8, 8.0e6, 0.6),
        },
        properties: {
          kind: 'firms',
          ...hotspot,
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
          kind: 'firms',
          ...hotspot,
        });
      }
    }
  }

  private applyVisibilityFilters(): void {
    this.dataSource.entities.suspendEvents();
    const jd = JulianDate.fromDate(new Date(this.clock.now()));
    for (const [, entity] of this.entityMap) {
      const props = entity.properties?.getValue(jd);
      const frp = Number(props?.frp_mw ?? 0);
      const conf = String(props?.confidence ?? '').toLowerCase();

      const matchesFrp = frp >= this.minFrp;
      const matchesConf = this.confidenceFilter === 'all' || conf.includes(this.confidenceFilter);

      entity.show = matchesFrp && matchesConf;
    }
    this.dataSource.entities.resumeEvents();
  }

  /**
   * Gets all active thermal hotspot IDs.
   */
  getHotspotIds(): string[] {
    return this.getEntityIds();
  }
}
