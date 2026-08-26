import type { LaunchCatalog, LaunchMission } from '@gev/contracts';
import { Cartesian3, Color, ConstantProperty, NearFarScalar } from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';

export interface LaunchLayerOptions extends BaseLayerOptions {}

/**
 * Space Launch Replays & Orbital Trajectories Layer Controller (PLAN.md §8 Layer 8)
 * Renders orbital trajectory arcs with Gold/Yellow (#facc15) styling.
 */
export class LaunchLayerController extends BaseLayerController<LaunchMission, LaunchLayerOptions> {
  private static readonly GOLD_YELLOW = Color.fromCssColorString('#facc15');
  private static readonly ARC_COLOR = Color.fromCssColorString('rgba(250, 204, 21, 0.75)');

  constructor(options: LaunchLayerOptions) {
    super(options, 'gev-launches');
  }

  /**
   * Enqueues a launch catalog for the next rAF drain cycle.
   */
  enqueueCatalog(catalog: LaunchCatalog): void {
    this.enqueueUpdates(catalog.missions);
  }

  protected getEntityId(mission: LaunchMission): string {
    return mission.id;
  }

  protected processEntity(mission: LaunchMission, id: string): void {
    const waypoints = mission.trajectory;
    const initialWp = waypoints[0];

    if (!initialWp) return;

    const positions = waypoints.map((wp) =>
      Cartesian3.fromDegrees(wp.longitude, wp.latitude, wp.altitude_m)
    );

    let entity = this.entityMap.get(id);

    if (!entity) {
      entity = this.dataSource.entities.add({
        id: `launch-${id}`,
        name: mission.name,
        position: Cartesian3.fromDegrees(
          initialWp.longitude,
          initialWp.latitude,
          initialWp.altitude_m
        ),
        point: {
          pixelSize: 9,
          color: LaunchLayerController.GOLD_YELLOW,
          outlineColor: Color.BLACK,
          outlineWidth: 1.5,
          scaleByDistance: new NearFarScalar(1.5e2, 1.8, 8.0e6, 0.7),
        },
        polyline: {
          positions: new ConstantProperty(positions),
          width: new ConstantProperty(2.5),
          material: LaunchLayerController.ARC_COLOR,
        },
        properties: {
          kind: 'launch',
          ...mission,
        },
      });
      this.entityMap.set(id, entity);
    } else {
      if (entity.polyline) {
        entity.polyline.positions = new ConstantProperty(positions);
      }
      if (entity.properties) {
        entity.properties.merge({
          kind: 'launch',
          ...mission,
        });
      }
    }
  }

  /**
   * Gets all active orbital launch mission IDs.
   */
  getMissionIds(): string[] {
    return this.getEntityIds();
  }
}
