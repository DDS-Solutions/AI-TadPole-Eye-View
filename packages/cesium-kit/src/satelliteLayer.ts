import {
  SATELLITE_USAGE_NOTICE,
  type SatellitePropagatedState,
  type SatellitePropagationBatch,
} from '@gev/contracts';
import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  NearFarScalar,
  type PropertyBag,
} from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

export interface SatelliteLayerOptions extends BaseLayerOptions {}

function satelliteProperties(state: SatellitePropagatedState) {
  return {
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
  };
}

function setConstantProperty(properties: PropertyBag, name: string, value: unknown): void {
  const property: unknown = properties[name];
  if (property instanceof ConstantProperty) {
    property.setValue(value);
    return;
  }
  if (properties.hasProperty(name)) properties.removeProperty(name);
  properties.addProperty(name, value);
}

function updateSatelliteProperties(properties: PropertyBag, state: SatellitePropagatedState): void {
  setConstantProperty(properties, 'objectId', state.object_id);
  setConstantProperty(properties, 'sourceGroup', state.source_group);
  setConstantProperty(properties, 'elementEpoch', state.element_epoch);
  setConstantProperty(properties, 'propagatedAt', state.propagated_at);
  setConstantProperty(properties, 'longitude', state.longitude_deg);
  setConstantProperty(properties, 'latitude', state.latitude_deg);
  setConstantProperty(properties, 'altitudeM', state.altitude_m);
  setConstantProperty(properties, 'speedMps', state.speed_mps);
}

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
        properties: satelliteProperties(state),
      });
      this.entityMap.set(id, entity);
      return;
    }
    entity.name = state.object_name;
    entity.position = new ConstantPositionProperty(position);
    if (entity.properties) updateSatelliteProperties(entity.properties, state);
  }
}
