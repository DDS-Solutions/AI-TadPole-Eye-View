import type { CctvCamera, CctvCatalog } from '@gev/contracts';
import { Cartesian3, Color, ConstantPositionProperty, JulianDate, NearFarScalar } from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

export interface CctvLayerOptions extends BaseLayerOptions {}

/**
 * Public CCTV & Traffic Camera Layer Controller (PLAN.md §8 Layer 6)
 * Renders verified DOT traffic cameras with the CCTV design channel.
 */
export class CctvLayerController extends BaseLayerController<CctvCamera, CctvLayerOptions> {
  private agencyFilter = 'all';

  private static readonly PURPLE_VIOLET = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.channels.cctv
  );
  private static readonly OUTLINE_COLOR = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.outlines.cctv
  );

  constructor(options: CctvLayerOptions) {
    super(options, 'gev-cctv');
  }

  /**
   * Enqueues a CCTV camera catalog for the next rAF drain cycle.
   */
  enqueueCatalog(catalog: CctvCatalog): void {
    this.enqueueUpdates(catalog.cameras);
  }

  /**
   * Sets agency filter (e.g. 'all', 'caltrans', 'nycdot', 'tfl').
   */
  setAgencyFilter(agency: string): void {
    this.agencyFilter = agency.toLowerCase();
    this.applyVisibilityFilters();
  }

  protected getEntityId(cam: CctvCamera): string {
    return cam.id;
  }

  protected processEntity(cam: CctvCamera, id: string): void {
    if (cam.longitude === null || cam.latitude === null) {
      return;
    }

    const position = Cartesian3.fromDegrees(cam.longitude, cam.latitude, 0);
    const isVisible =
      this.agencyFilter === 'all' || cam.agency.toLowerCase().includes(this.agencyFilter);

    let entity = this.entityMap.get(id);

    if (!entity) {
      entity = this.dataSource.entities.add({
        id: `cctv-${id}`,
        name: cam.name,
        show: isVisible,
        position,
        point: {
          pixelSize: 8,
          color: CctvLayerController.PURPLE_VIOLET,
          outlineColor: CctvLayerController.OUTLINE_COLOR,
          outlineWidth: 1.5,
          scaleByDistance: new NearFarScalar(1.5e2, 1.6, 8.0e6, 0.6),
        },
        properties: {
          kind: 'cctv',
          ...cam,
        },
      });
      this.entityMap.set(id, entity);
    } else {
      entity.position = new ConstantPositionProperty(position);
      entity.show = isVisible;
      if (entity.properties) {
        entity.properties.merge({
          kind: 'cctv',
          ...cam,
        });
      }
    }
  }

  private applyVisibilityFilters(): void {
    this.dataSource.entities.suspendEvents();
    const jd = JulianDate.fromDate(new Date(this.clock.now()));
    for (const [, entity] of this.entityMap) {
      const agency = entity.properties?.getValue(jd)?.agency ?? '';
      const isMatch =
        this.agencyFilter === 'all' || String(agency).toLowerCase().includes(this.agencyFilter);
      entity.show = isMatch;
    }
    this.dataSource.entities.resumeEvents();
  }

  /**
   * Gets all active camera IDs.
   */
  getCameraIds(): string[] {
    return this.getEntityIds();
  }
}
