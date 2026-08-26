import type { WeatherCollection, WeatherStation } from '@gev/contracts';
import { Cartesian3, Color, ConstantPositionProperty, NearFarScalar } from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';

export interface WeatherLayerOptions extends BaseLayerOptions {
  enableRadarImagery?: boolean;
}

/**
 * Weather Radar & Meteorological Observations Layer Controller (PLAN.md §8 Layer 9)
 * Renders meteorological observations with Sky Blue (#60a5fa) styling.
 */
export class WeatherLayerController extends BaseLayerController<
  WeatherStation,
  WeatherLayerOptions
> {
  public radarTileTemplate?: string;

  private static readonly SKY_BLUE = Color.fromCssColorString('#60a5fa');
  private static readonly OUTLINE_COLOR = Color.fromCssColorString('#1e3a8a');

  constructor(options: WeatherLayerOptions) {
    super(options, 'gev-weather');
  }

  /**
   * Enqueues a weather collection for the next rAF drain cycle.
   */
  enqueueWeather(weather: WeatherCollection): void {
    this.radarTileTemplate = weather.radar_tile_template;
    this.enqueueUpdates(weather.stations);
  }

  protected getEntityId(station: WeatherStation): string {
    return station.id;
  }

  protected processEntity(station: WeatherStation, id: string): void {
    if (station.longitude === null || station.latitude === null) {
      return;
    }

    const position = Cartesian3.fromDegrees(station.longitude, station.latitude, 0);

    let entity = this.entityMap.get(id);

    if (!entity) {
      entity = this.dataSource.entities.add({
        id: `weather-${id}`,
        name: `${station.name} (${station.temp_c}°C, ${station.condition})`,
        position,
        point: {
          pixelSize: 8,
          color: WeatherLayerController.SKY_BLUE,
          outlineColor: WeatherLayerController.OUTLINE_COLOR,
          outlineWidth: 1.5,
          scaleByDistance: new NearFarScalar(1.5e2, 1.6, 8.0e6, 0.6),
        },
        properties: {
          kind: 'weather',
          ...station,
        },
      });
      this.entityMap.set(id, entity);
    } else {
      entity.position = new ConstantPositionProperty(position);
      if (entity.properties) {
        entity.properties.merge({
          kind: 'weather',
          ...station,
        });
      }
    }
  }

  /**
   * Gets all active weather station IDs.
   */
  getStationIds(): string[] {
    return this.getEntityIds();
  }
}
