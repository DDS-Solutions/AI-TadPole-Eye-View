import type {
  AviationWeatherItem,
  AviationWeatherResponse,
  OperationalAreaGeometry,
} from '@gev/contracts';
import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  NearFarScalar,
  PolygonHierarchy,
} from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

function outerRing(geometry: OperationalAreaGeometry): Array<[number, number]> {
  return geometry.type === 'Polygon'
    ? (geometry.coordinates[0] ?? [])
    : (geometry.coordinates[0]?.[0] ?? []);
}

export class AviationWeatherLayerController extends BaseLayerController<
  AviationWeatherItem,
  BaseLayerOptions
> {
  constructor(options: BaseLayerOptions) {
    super(options, 'gev-aviation-weather');
  }

  enqueueWeather(response: AviationWeatherResponse): void {
    this.enqueueUpdates([
      ...response.metars.items.map((item) => ({ ...item, product: 'metar' as const })),
      ...response.tafs.items.map((item) => ({ ...item, product: 'taf' as const })),
      ...response.sigmets.items.map((item) => ({ ...item, product: 'sigmet' as const })),
    ]);
  }

  clear(): void {
    this.enqueueUpdates([]);
  }

  protected getEntityId(item: AviationWeatherItem): string {
    return `${item.product}-${item.id}`;
  }

  protected processEntity(item: AviationWeatherItem, id: string): void {
    if (item.product === 'sigmet') {
      this.processSigmet(item, id);
      return;
    }
    const position = Cartesian3.fromDegrees(item.position.longitude, item.position.latitude, 0);
    const existing = this.entityMap.get(id);
    if (!existing) {
      const entity = this.dataSource.entities.add({
        id: `aviation-weather-${id}`,
        name: `${item.product.toUpperCase()} ${item.station_id}`,
        position,
        point: {
          pixelSize: item.product === 'metar' ? 7 : 5,
          color: Color.fromCssColorString(CESIUM_DESIGN_TOKENS.channels.aviation),
          outlineColor: Color.fromCssColorString(CESIUM_DESIGN_TOKENS.outlines.default),
          outlineWidth: 1,
          scaleByDistance: new NearFarScalar(150, 1.6, 8_000_000, 0.6),
        },
        properties: {
          entityKind: 'aviation-weather',
          longitude: item.position.longitude,
          latitude: item.position.latitude,
          ...item,
        },
      });
      this.entityMap.set(id, entity);
      return;
    }
    existing.position = new ConstantPositionProperty(position);
    existing.properties?.merge({ entityKind: 'aviation-weather', ...item });
  }

  private processSigmet(item: Extract<AviationWeatherItem, { product: 'sigmet' }>, id: string) {
    const ring = outerRing(item.geometry);
    if (ring.length < 4) return;
    const positions = ring.map(([longitude, latitude]) =>
      Cartesian3.fromDegrees(longitude, latitude)
    );
    const color = Color.fromCssColorString(CESIUM_DESIGN_TOKENS.governance.attention);
    const existing = this.entityMap.get(id);
    if (!existing) {
      const entity = this.dataSource.entities.add({
        id: `aviation-weather-${id}`,
        name: `SIGMET ${item.hazard}`,
        position: positions[0],
        polygon: {
          hierarchy: new PolygonHierarchy(positions),
          material: color.withAlpha(0.14),
          outline: true,
          outlineColor: color,
        },
        properties: { entityKind: 'aviation-weather', ...item },
      });
      this.entityMap.set(id, entity);
      return;
    }
    existing.position = new ConstantPositionProperty(positions[0] as Cartesian3);
    if (existing.polygon) {
      existing.polygon.hierarchy = new ConstantProperty(new PolygonHierarchy(positions));
    }
    existing.properties?.merge({ entityKind: 'aviation-weather', ...item });
  }

  getWeatherIds(): string[] {
    return this.getEntityIds();
  }
}
