import type {
  CableCatalogResponse,
  CableCoordinate,
  CableLandingPoint,
  CableRoute,
} from '@gev/contracts';
import {
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  NearFarScalar,
} from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';
import { CESIUM_DESIGN_TOKENS } from './designTokens.js';

type CableRenderItem =
  | { kind: 'landing'; landingPoint: CableLandingPoint }
  | {
      kind: 'segment';
      route: CableRoute;
      segmentIndex: number;
      coordinates: CableCoordinate[];
    };

export interface CableLayerOptions extends BaseLayerOptions {}

/** Renders validated submarine routes and landing points through the shared rAF drain. */
export class CableLayerController extends BaseLayerController<CableRenderItem, CableLayerOptions> {
  private static readonly CABLE_COLOR = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.channels.cables
  );
  private static readonly OUTLINE_COLOR = Color.fromCssColorString(
    CESIUM_DESIGN_TOKENS.outlines.cables
  );
  private routeCount = 0;
  private landingPointCount = 0;

  constructor(options: CableLayerOptions) {
    super(options, 'gev-cables');
  }

  enqueueCatalog(catalog: CableCatalogResponse): void {
    this.routeCount = catalog.routes.length;
    this.landingPointCount = catalog.landing_points.length;
    const items: CableRenderItem[] = catalog.landing_points.map((landingPoint) => ({
      kind: 'landing',
      landingPoint,
    }));
    for (const route of catalog.routes) {
      for (const [segmentIndex, coordinates] of route.segments.entries()) {
        items.push({ kind: 'segment', route, segmentIndex, coordinates });
      }
    }
    this.enqueueUpdates(items);
  }

  getRouteCount(): number {
    return this.routeCount;
  }

  getLandingPointCount(): number {
    return this.landingPointCount;
  }

  protected getEntityId(item: CableRenderItem): string {
    return item.kind === 'landing'
      ? `landing:${item.landingPoint.id}`
      : `route:${item.route.id}:segment:${item.segmentIndex}`;
  }

  protected processEntity(item: CableRenderItem, id: string): void {
    if (item.kind === 'landing') {
      this.processLandingPoint(item.landingPoint, id);
      return;
    }
    this.processRouteSegment(item.route, item.segmentIndex, item.coordinates, id);
  }

  private processLandingPoint(landingPoint: CableLandingPoint, id: string): void {
    let entity = this.entityMap.get(id);
    const position = Cartesian3.fromDegrees(landingPoint.longitude, landingPoint.latitude, 0);
    if (!entity) {
      entity = this.dataSource.entities.add({
        id: `cable-landing-${landingPoint.id}`,
        name: landingPoint.name,
        position,
        point: {
          pixelSize: 7,
          color: CableLayerController.CABLE_COLOR,
          outlineColor: CableLayerController.OUTLINE_COLOR,
          outlineWidth: 1.5,
          scaleByDistance: new NearFarScalar(1.5e2, 1.6, 1.2e7, 0.6),
        },
        properties: {
          entityKind: 'cable',
          featureType: 'landing_point',
          landingPointId: landingPoint.id,
          country: landingPoint.country,
          longitude: landingPoint.longitude,
          latitude: landingPoint.latitude,
        },
      });
      this.entityMap.set(id, entity);
      return;
    }
    entity.position = new ConstantPositionProperty(position);
  }

  private processRouteSegment(
    route: CableRoute,
    segmentIndex: number,
    coordinates: CableCoordinate[],
    id: string
  ): void {
    const positions = coordinates.map(([longitude, latitude]) =>
      Cartesian3.fromDegrees(longitude, latitude, 0)
    );
    let entity = this.entityMap.get(id);
    if (!entity) {
      entity = this.dataSource.entities.add({
        id: `cable-route-${route.id}-${segmentIndex}`,
        name: route.name,
        polyline: {
          positions: new ConstantProperty(positions),
          width: new ConstantProperty(2),
          material: CableLayerController.CABLE_COLOR,
        },
        properties: {
          entityKind: 'cable',
          featureType: 'route_segment',
          routeId: route.id,
          segmentIndex,
          status: route.status,
          owners: route.owners.join(', '),
          rfsYear: route.rfs_year,
          lengthKm: route.length_km,
        },
      });
      this.entityMap.set(id, entity);
      return;
    }
    if (entity.polyline) {
      entity.polyline.positions = new ConstantProperty(positions);
    }
  }
}
