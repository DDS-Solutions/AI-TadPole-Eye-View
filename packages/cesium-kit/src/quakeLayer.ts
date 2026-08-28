import type { EarthquakeCollection, EarthquakeFeature } from '@gev/contracts';
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

export interface QuakeLayerOptions extends BaseLayerOptions {
  minMagnitude?: number;
}

/**
 * USGS Earthquakes Layer Controller (PLAN.md §8 Layer 3 & DESIGN.md §2.2)
 * Renders seismic telemetry with the seismic design channel.
 * Drains incoming collections through requestAnimationFrame queue straight into Cesium.
 */
export class QuakeLayerController extends BaseLayerController<
  EarthquakeFeature,
  QuakeLayerOptions
> {
  private minMagnitude: number;

  private static readonly AMBER_ORANGE = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.channels.seismic
  );
  private static readonly OUTLINE_COLOR = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.outlines.seismic
  );

  constructor(options: QuakeLayerOptions) {
    super(options, 'gev-quakes');
    this.minMagnitude = options.minMagnitude ?? 0;
  }

  /**
   * Enqueues an earthquake collection for the next rAF drain cycle.
   */
  enqueueCollection(collection: EarthquakeCollection): void {
    this.enqueueUpdates(collection.features);
  }

  /**
   * Sets minimum magnitude filter (e.g. 2.5, 4.5).
   */
  setMinMagnitude(minMag: number): void {
    this.minMagnitude = minMag;
    this.applyVisibilityFilters();
  }

  protected getEntityId(quake: EarthquakeFeature): string {
    return quake.id;
  }

  protected processEntity(quake: EarthquakeFeature, id: string): void {
    if (quake.longitude === null || quake.latitude === null) {
      return;
    }

    const position = Cartesian3.fromDegrees(quake.longitude, quake.latitude, 0);
    const isVisible = quake.mag >= this.minMagnitude;

    // Magnitude-scaled pixel size (e.g. M2 -> 6px, M5 -> 15px, M8 -> 24px)
    const pixelSize = Math.max(6, Math.min(30, quake.mag * 3.5));

    let entity = this.entityMap.get(id);

    if (!entity) {
      entity = this.dataSource.entities.add({
        id: `quake-${id}`,
        name: `M${quake.mag.toFixed(1)} - ${quake.place}`,
        show: isVisible,
        position,
        point: {
          pixelSize,
          color: QuakeLayerController.AMBER_ORANGE,
          outlineColor: QuakeLayerController.OUTLINE_COLOR,
          outlineWidth: 1.5,
          scaleByDistance: new NearFarScalar(1.5e2, 1.8, 8.0e6, 0.7),
        },
        properties: {
          kind: 'quake',
          ...quake,
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
          kind: 'quake',
          ...quake,
        });
      }
    }
  }

  private applyVisibilityFilters(): void {
    this.dataSource.entities.suspendEvents();
    const jd = JulianDate.fromDate(new Date(this.clock.now()));
    for (const [, entity] of this.entityMap) {
      const mag = entity.properties?.getValue(jd)?.mag ?? 0;
      entity.show = Number(mag) >= this.minMagnitude;
    }
    this.dataSource.entities.resumeEvents();
  }

  /**
   * Gets all active earthquake IDs.
   */
  getQuakeIds(): string[] {
    return this.getEntityIds();
  }
}
