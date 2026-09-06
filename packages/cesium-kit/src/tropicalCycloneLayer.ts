import type {
  OperationalAreaGeometry,
  TropicalCycloneAdvisory,
  TropicalCycloneResponse,
} from '@gev/contracts';
import { Cartesian3, Color, PolygonHierarchy } from 'cesium';
import {
  BaseLayerController,
  type BaseLayerOptions,
  setEntityPosition,
  setPolygonHierarchy,
  setPolylinePositions,
} from './baseLayer.js';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

const DANGER_COLOR = Color.fromCssColorString(CESIUM_DESIGN_TOKENS.governance.danger);
const ATTENTION_COLOR = Color.fromCssColorString(CESIUM_DESIGN_TOKENS.governance.attention);
const WEATHER_COLOR = Color.fromCssColorString(CESIUM_DESIGN_TOKENS.channels.weather);

function outerRing(geometry: OperationalAreaGeometry): Array<[number, number]> {
  return geometry.type === 'Polygon'
    ? (geometry.coordinates[0] ?? [])
    : (geometry.coordinates[0]?.[0] ?? []);
}

function colorFor(advisory: TropicalCycloneAdvisory): Color {
  return advisory.product === 'watch_warning'
    ? DANGER_COLOR
    : advisory.product === 'cone'
      ? ATTENTION_COLOR
      : WEATHER_COLOR;
}

export class TropicalCycloneLayerController extends BaseLayerController<
  TropicalCycloneAdvisory,
  BaseLayerOptions
> {
  constructor(options: BaseLayerOptions) {
    super(options, 'gev-tropical-cyclones');
  }

  enqueueAdvisories(response: TropicalCycloneResponse): void {
    this.enqueueUpdates(response.advisories);
  }

  clear(): void {
    this.enqueueUpdates([]);
  }

  protected getEntityId(advisory: TropicalCycloneAdvisory): string {
    return advisory.id;
  }

  protected processEntity(advisory: TropicalCycloneAdvisory, id: string): void {
    const coordinates =
      advisory.geometry.type === 'LineString'
        ? advisory.geometry.coordinates
        : outerRing(advisory.geometry);
    if (coordinates.length < 2) return;
    const positions = coordinates.map(([longitude, latitude]) =>
      Cartesian3.fromDegrees(longitude, latitude)
    );
    const existing = this.entityMap.get(id);
    if (existing) {
      setEntityPosition(existing, positions[0] as Cartesian3);
      if (existing.polyline) setPolylinePositions(existing, positions);
      if (existing.polygon) setPolygonHierarchy(existing, new PolygonHierarchy(positions));
      existing.properties?.merge({ entityKind: 'tropical-cyclone', ...advisory });
      return;
    }
    const color = colorFor(advisory);
    const common = {
      id: `tropical-cyclone-${id}`,
      name: `${advisory.storm_type} ${advisory.storm_name} · ${advisory.product.replace('_', ' ')}`,
      position: positions[0],
      properties: {
        entityKind: 'tropical-cyclone',
        ...advisory,
      },
    };
    const entity =
      advisory.geometry.type === 'LineString'
        ? this.dataSource.entities.add({
            ...common,
            polyline: {
              positions,
              width: advisory.product === 'track' ? 3 : 5,
              material: color.withAlpha(0.9),
              clampToGround: true,
            },
          })
        : this.dataSource.entities.add({
            ...common,
            polygon: {
              hierarchy: new PolygonHierarchy(positions),
              material: color.withAlpha(0.16),
              outline: true,
              outlineColor: color,
            },
          });
    this.entityMap.set(id, entity);
  }

  getAdvisoryIds(): string[] {
    return this.getEntityIds();
  }
}
