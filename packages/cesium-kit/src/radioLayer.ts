import type { RadioCatalog, RadioStation } from '@gev/contracts';
import { Cartesian3, Color, ConstantPositionProperty, JulianDate, NearFarScalar } from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

export interface RadioLayerOptions extends BaseLayerOptions {}

/**
 * Global Radio & ATC Broadcast Layer Controller (PLAN.md §8 Layer 7)
 * Renders radio transmission towers with the radio design channel.
 */
export class RadioLayerController extends BaseLayerController<RadioStation, RadioLayerOptions> {
  private categoryFilter = 'all';

  private static readonly CYAN_STREAM = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.channels.radio
  );
  private static readonly OUTLINE_COLOR = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.outlines.radio
  );

  constructor(options: RadioLayerOptions) {
    super(options, 'gev-radio');
  }

  /**
   * Enqueues a radio station catalog for the next rAF drain cycle.
   */
  enqueueCatalog(catalog: RadioCatalog): void {
    this.enqueueUpdates(catalog.stations);
  }

  /**
   * Sets category filter ('all', 'atc', 'marine', 'emergency', 'broadcast').
   */
  setCategoryFilter(category: string): void {
    this.categoryFilter = category.toLowerCase();
    this.applyVisibilityFilters();
  }

  protected getEntityId(station: RadioStation): string {
    return station.id;
  }

  protected processEntity(station: RadioStation, id: string): void {
    if (station.longitude === null || station.latitude === null) {
      return;
    }

    const position = Cartesian3.fromDegrees(station.longitude, station.latitude, 0);
    const isVisible =
      this.categoryFilter === 'all' || station.category.toLowerCase() === this.categoryFilter;

    let entity = this.entityMap.get(id);

    if (!entity) {
      entity = this.dataSource.entities.add({
        id: `radio-${id}`,
        name: station.name,
        show: isVisible,
        position,
        point: {
          pixelSize: 8,
          color: RadioLayerController.CYAN_STREAM,
          outlineColor: RadioLayerController.OUTLINE_COLOR,
          outlineWidth: 1.5,
          scaleByDistance: new NearFarScalar(1.5e2, 1.6, 8.0e6, 0.6),
        },
        properties: {
          kind: 'radio',
          ...station,
        },
      });
      this.entityMap.set(id, entity);
    } else {
      entity.position = new ConstantPositionProperty(position);
      entity.show = isVisible;
      if (entity.properties) {
        entity.properties.merge({
          kind: 'radio',
          ...station,
        });
      }
    }
  }

  private applyVisibilityFilters(): void {
    this.dataSource.entities.suspendEvents();
    const jd = JulianDate.fromDate(new Date(this.clock.now()));
    for (const [, entity] of this.entityMap) {
      const cat = entity.properties?.getValue(jd)?.category ?? '';
      const isMatch =
        this.categoryFilter === 'all' || String(cat).toLowerCase() === this.categoryFilter;
      entity.show = isMatch;
    }
    this.dataSource.entities.resumeEvents();
  }

  /**
   * Gets all active radio station IDs.
   */
  getStationIds(): string[] {
    return this.getEntityIds();
  }

  /**
   * Gets all active radio station IDs (alias).
   */
  getRadioIds(): string[] {
    return this.getEntityIds();
  }
}
