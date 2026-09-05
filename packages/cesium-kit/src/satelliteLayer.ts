import {
  SATELLITE_USAGE_NOTICE,
  type SatellitePropagatedState,
  type SatellitePropagationBatch,
} from '@gev/contracts';
import { Cartesian3, Color, ConstantPositionProperty, NearFarScalar } from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

export interface SatelliteLayerOptions extends BaseLayerOptions {}

/** Renders bounded, derived satellite estimates through the shared rAF drain. */
export class SatelliteLayerController extends BaseLayerController<
  SatellitePropagatedState,
  SatelliteLayerOptions
> {
  private static readonly COLOR = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.channels.satellites
  );
  private static readonly OUTLINE = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.outlines.satellites
  );

  constructor(options: SatelliteLayerOptions) {
    super(options, 'gev-satellites');
  }

  enqueueBatch(batch: SatellitePropagationBatch): void {
    this.enqueueUpdates(batch.states);
  }

  getSatelliteIds(): string[] {
    return this.getEntityIds();
  }

  protected getEntityId(state: SatellitePropagatedState): string {
    return state.catalog_id;
  }

  protected processEntity(state: SatellitePropagatedState, id: string): void {
    const position = Cartesian3.fromDegrees(
      state.longitude_deg,
      state.latitude_deg,
      state.altitude_m
    );
    let entity = this.entityMap.get(id);
    if (!entity) {
      entity = this.dataSource.entities.add({
        id: `satellite-${state.catalog_id}`,
        name: state.object_name,
        position,
        point: {
          pixelSize: 6,
          color: SatelliteLayerController.COLOR,
          outlineColor: SatelliteLayerController.OUTLINE,
          outlineWidth: 1.5,
          scaleByDistance: new NearFarScalar(1.0e5, 1.7, 8.0e7, 0.65),
        },
        properties: {
          entityKind: 'satellite',
          catalogId: state.catalog_id,
          objectId: state.object_id,
          sourceGroup: state.source_group,
          elementEpoch: state.element_epoch,
          propagatedAt: state.propagated_at,
          propagationMethod: state.propagation_method,
          isEstimate: state.is_estimate,
          usageNotice: SATELLITE_USAGE_NOTICE,
          longitude: state.longitude_deg,
          latitude: state.latitude_deg,
          altitudeM: state.altitude_m,
          speedMps: state.speed_mps,
        },
      });
      this.entityMap.set(id, entity);
      return;
    }
    entity.name = state.object_name;
    entity.position = new ConstantPositionProperty(position);
  }
}
