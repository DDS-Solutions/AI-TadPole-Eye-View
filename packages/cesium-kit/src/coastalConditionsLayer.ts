import type { CoastalConditionsResponse, CoastalStation, CoastalValue } from '@gev/contracts';
import { Cartesian3, Color, ConstantPositionProperty, NearFarScalar } from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

function available(value: CoastalValue | undefined): number | null {
  return value?.status === 'available' ? value.value : null;
}

export class CoastalConditionsLayerController extends BaseLayerController<
  CoastalStation,
  BaseLayerOptions
> {
  constructor(options: BaseLayerOptions) {
    super(options, 'gev-coastal-conditions');
  }

  enqueueConditions(response: CoastalConditionsResponse): void {
    this.enqueueUpdates(response.stations);
  }

  clear(): void {
    this.enqueueUpdates([]);
  }

  protected getEntityId(station: CoastalStation): string {
    return station.station_id;
  }

  protected processEntity(station: CoastalStation, id: string): void {
    const position = Cartesian3.fromDegrees(station.position.longitude, station.position.latitude);
    const latestWater = station.water_level_observations.at(-1);
    const nextTide = station.tide_predictions[0];
    const latestCurrent = station.current_observations.at(-1);
    const nextCurrent = station.current_predictions[0];
    const properties = {
      entityKind: 'coastal-condition',
      stationId: station.station_id,
      datum: station.datum,
      units: station.units,
      timeZone: station.time_zone,
      stationTimeZoneName: station.station_time_zone_name,
      metadataRetrievedAt: station.metadata_retrieved_at,
      latestWaterLevel: available(latestWater?.value),
      latestWaterLevelObservedAt: latestWater?.observed_at ?? null,
      latestWaterLevelQuality: latestWater?.quality ?? null,
      nextTideLevel: available(nextTide?.value),
      nextTideValidAt: nextTide?.valid_at ?? null,
      latestCurrentSpeed: available(latestCurrent?.speed),
      latestCurrentDirection: available(latestCurrent?.direction_deg),
      latestCurrentObservedAt: latestCurrent?.observed_at ?? null,
      nextCurrentSpeed: available(nextCurrent?.speed),
      nextCurrentDirection: available(nextCurrent?.direction_deg),
      nextCurrentValidAt: nextCurrent?.valid_at ?? null,
      longitude: station.position.longitude,
      latitude: station.position.latitude,
    };
    const existing = this.entityMap.get(id);
    if (existing) {
      existing.position = new ConstantPositionProperty(position);
      existing.properties?.merge(properties);
      return;
    }
    const entity = this.dataSource.entities.add({
      id: `coastal-condition-${id}`,
      name: station.name,
      position,
      point: {
        pixelSize: 8,
        color: Color.fromCssColorString(CESIUM_DESIGN_TOKENS.channels.maritime),
        outlineColor: Color.fromCssColorString(CESIUM_DESIGN_TOKENS.outlines.maritime),
        outlineWidth: 1,
        scaleByDistance: new NearFarScalar(150, 1.7, 8_000_000, 0.65),
      },
      properties,
    });
    this.entityMap.set(id, entity);
  }

  getCoastalStationIds(): string[] {
    return this.getEntityIds();
  }
}
