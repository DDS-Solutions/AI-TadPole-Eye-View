import type {
  AviationWeatherItem,
  AviationWeatherResponse,
  OperationalAreaGeometry,
} from '@gev/contracts';
import { Cartesian3, Color, NearFarScalar, PolygonHierarchy } from 'cesium';
import {
  BaseLayerController,
  type BaseLayerOptions,
  setEntityPosition,
  setPolygonHierarchy,
} from './baseLayer.js';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

const AVIATION_COLOR = Color.fromCssColorString(CESIUM_DESIGN_TOKENS.channels.aviation);
const DEFAULT_OUTLINE = Color.fromCssColorString(CESIUM_DESIGN_TOKENS.outlines.default);
const ATTENTION_COLOR = Color.fromCssColorString(CESIUM_DESIGN_TOKENS.governance.attention);

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
    const metars = response.metars.items;
    const tafs = response.tafs.items;
    const sigmets = response.sigmets.items;
    const items: AviationWeatherItem[] = [];
    for (let i = 0; i < metars.length; i++) {
      const item = metars[i];
      if (item) items.push({ ...item, product: 'metar' });
    }
    for (let i = 0; i < tafs.length; i++) {
      const item = tafs[i];
      if (item) items.push({ ...item, product: 'taf' });
    }
    for (let i = 0; i < sigmets.length; i++) {
      const item = sigmets[i];
      if (item) items.push({ ...item, product: 'sigmet' });
    }
    this.enqueueUpdates(items);
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
          color: AVIATION_COLOR,
          outlineColor: DEFAULT_OUTLINE,
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
    setEntityPosition(existing, position);
    existing.properties?.merge({ entityKind: 'aviation-weather', ...item });
  }

  private processSigmet(item: Extract<AviationWeatherItem, { product: 'sigmet' }>, id: string) {
    const ring = outerRing(item.geometry);
    if (ring.length < 4) return;
    const positions = ring.map(([longitude, latitude]) =>
      Cartesian3.fromDegrees(longitude, latitude)
    );
    const existing = this.entityMap.get(id);
    if (!existing) {
      const entity = this.dataSource.entities.add({
        id: `aviation-weather-${id}`,
        name: `SIGMET ${item.hazard}`,
        position: positions[0],
        polygon: {
          hierarchy: new PolygonHierarchy(positions),
          material: ATTENTION_COLOR.withAlpha(0.14),
          outline: true,
          outlineColor: ATTENTION_COLOR,
        },
        properties: { entityKind: 'aviation-weather', ...item },
      });
      this.entityMap.set(id, entity);
      return;
    }
    setEntityPosition(existing, positions[0] as Cartesian3);
    setPolygonHierarchy(existing, new PolygonHierarchy(positions));
    existing.properties?.merge({ entityKind: 'aviation-weather', ...item });
  }

  getWeatherIds(): string[] {
    return this.getEntityIds();
  }
}
