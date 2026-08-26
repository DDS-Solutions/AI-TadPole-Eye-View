import type { ThermalHotspot, ThermalHotspotBatch } from '@gev/contracts';
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

export interface FirmsLayerOptions {
  viewer: Viewer;
  clock?: SimClock;
  dataSourceName?: string;
  minFrp?: number;
  confidenceFilter?: string;
}

/**
 * NASA FIRMS Thermal Hotspots Layer Controller (PLAN.md §8 Layer 4 & DESIGN.md §2.2)
 * Renders Thermal telemetry with Rose Red (#f43f5e) FRP-scaled cluster primitives.
 * Drains incoming batches through requestAnimationFrame queue straight into Cesium.
 */
export class FirmsLayerController {
  public readonly dataSource: CustomDataSource;
  public readonly clock: SimClock;
  private readonly viewer: Viewer;
  private readonly entityMap = new Map<string, Entity>();
  private pendingUpdates: ThermalHotspot[] = [];
  private minFrp: number;
  private confidenceFilter: string;
  private rafHandle: number | null = null;
  private isDestroyed = false;

  private static readonly ROSE_RED = Color.fromCssColorString('#f43f5e');
  private static readonly OUTLINE_COLOR = Color.fromCssColorString('#881337');

  constructor(options: FirmsLayerOptions) {
    this.viewer = options.viewer;
    this.clock = options.clock ?? new SystemClock();
    this.minFrp = options.minFrp ?? 0;
    this.confidenceFilter = (options.confidenceFilter ?? 'all').toLowerCase();
    this.dataSource = new CustomDataSource(options.dataSourceName ?? 'gev-firms');
    this.viewer.dataSources.add(this.dataSource);
  }

  /**
   * Enqueues a thermal hotspot batch for the next rAF drain cycle.
   */
  enqueueBatch(batch: ThermalHotspotBatch): void {
    if (this.isDestroyed) return;

    this.pendingUpdates.push(...batch.hotspots);
    this.scheduleRafDrain();
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

  /**
   * Toggles visibility of the entire thermal hotspots layer.
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
      const hotspot = updates[i];
      if (!hotspot || hotspot.longitude === null || hotspot.latitude === null) {
        continue;
      }

      const id = hotspot.id;
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
          entity.point.pixelSize = pixelSize as unknown as undefined;
        }
        if (entity.properties) {
          entity.properties.merge({
            kind: 'firms',
            ...hotspot,
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
      const props = entity.properties?.getValue(jd);
      const frp = Number(props?.frp_mw ?? 0);
      const conf = String(props?.confidence ?? '').toLowerCase();

      const matchesFrp = frp >= this.minFrp;
      const matchesConf = this.confidenceFilter === 'all' || conf.includes(this.confidenceFilter);

      entity.show = matchesFrp && matchesConf;
    }
    this.dataSource.entities.resumeEvents();
  }

  getEntityCount(): number {
    return this.entityMap.size;
  }

  getHotspotIds(): string[] {
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
