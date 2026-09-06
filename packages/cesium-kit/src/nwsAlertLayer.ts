import type { NwsAlert, NwsAlertCollection, OperationalAreaGeometry } from '@gev/contracts';
import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  PolygonHierarchy,
} from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

function outerRing(geometry: OperationalAreaGeometry): Array<[number, number]> {
  return geometry.type === 'Polygon'
    ? (geometry.coordinates[0] ?? [])
    : (geometry.coordinates[0]?.[0] ?? []);
}

function alertColor(alert: NwsAlert): Color {
  return Color.fromCssColorString(
    alert.severity === 'Extreme' || alert.severity === 'Severe'
      ? CESIUM_DESIGN_TOKENS.governance.danger
      : CESIUM_DESIGN_TOKENS.governance.attention
  );
}

export class NwsAlertLayerController extends BaseLayerController<NwsAlert, BaseLayerOptions> {
  constructor(options: BaseLayerOptions) {
    super(options, 'gev-nws-alerts');
  }

  enqueueCollection(collection: NwsAlertCollection): void {
    this.enqueueUpdates(collection.alerts);
  }

  clear(): void {
    this.enqueueUpdates([]);
  }

  protected getEntityId(alert: NwsAlert): string {
    return alert.id;
  }

  protected processEntity(alert: NwsAlert, id: string): void {
    const ring = outerRing(alert.geometry);
    if (ring.length < 4) return;
    const positions = ring.map(([longitude, latitude]) =>
      Cartesian3.fromDegrees(longitude, latitude)
    );
    const color = alertColor(alert);
    const existing = this.entityMap.get(id);
    if (!existing) {
      const entity = this.dataSource.entities.add({
        id: `nws-alert-${id}`,
        name: alert.headline,
        position: positions[0],
        polygon: {
          hierarchy: new PolygonHierarchy(positions),
          material: color.withAlpha(0.2),
          outline: true,
          outlineColor: color,
        },
        properties: { entityKind: 'nws-alert', ...alert },
      });
      this.entityMap.set(id, entity);
      return;
    }
    existing.position = new ConstantPositionProperty(positions[0] as Cartesian3);
    if (existing.polygon) {
      existing.polygon.hierarchy = new ConstantProperty(new PolygonHierarchy(positions));
    }
    existing.properties?.merge({ entityKind: 'nws-alert', ...alert });
  }

  getAlertIds(): string[] {
    return this.getEntityIds();
  }
}
