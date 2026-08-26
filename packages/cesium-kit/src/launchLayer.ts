import type { LaunchCatalog, LaunchMission } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import {
  Cartesian3,
  Color,
  ConstantProperty,
  CustomDataSource,
  type Entity,
  NearFarScalar,
  type Viewer,
} from 'cesium';

export interface LaunchLayerOptions {
  viewer: Viewer;
  clock?: SimClock;
  dataSourceName?: string;
}

/**
 * Space Launch Replays & Orbital Trajectories Layer Controller (PLAN.md §8 Layer 8)
 * Renders orbital trajectory arcs with Gold/Yellow (#facc15) styling.
 */
export class LaunchLayerController {
  public readonly dataSource: CustomDataSource;
  public readonly clock: SimClock;
  private readonly viewer: Viewer;
  private readonly entityMap = new Map<string, Entity>();
  private pendingUpdates: LaunchMission[] = [];
  private rafHandle: number | null = null;
  private isDestroyed = false;

  private static readonly GOLD_YELLOW = Color.fromCssColorString('#facc15');
  private static readonly ARC_COLOR = Color.fromCssColorString('rgba(250, 204, 21, 0.75)');

  constructor(options: LaunchLayerOptions) {
    this.viewer = options.viewer;
    this.clock = options.clock ?? new SystemClock();
    this.dataSource = new CustomDataSource(options.dataSourceName ?? 'gev-launches');
    this.viewer.dataSources.add(this.dataSource);
  }

  /**
   * Enqueues a launch catalog for the next rAF drain cycle.
   */
  enqueueCatalog(catalog: LaunchCatalog): void {
    if (this.isDestroyed) return;

    this.pendingUpdates.push(...catalog.missions);
    this.scheduleRafDrain();
  }

  /**
   * Toggles visibility of the entire launch trajectories layer.
   */
  setVisible(visible: boolean): void {
    this.dataSource.show = visible;
  }

  private scheduleRafDrain(): void {
    if (this.rafHandle !== null || typeof requestAnimationFrame !== 'function') {
      if (typeof requestAnimationFrame !== 'function') {
        this.drainQueue();
      }
      return;
    }

    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    if (this.pendingUpdates.length === 0 || this.isDestroyed) return;

    const updates = this.pendingUpdates;
    this.pendingUpdates = [];

    this.dataSource.entities.suspendEvents();

    for (let i = 0; i < updates.length; i++) {
      const mission = updates[i];
      if (!mission) continue;

      const id = mission.id;
      const waypoints = mission.trajectory;
      const initialWp = waypoints[0];

      if (!initialWp) continue;

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

    this.dataSource.entities.resumeEvents();
  }

  getEntityCount(): number {
    return this.entityMap.size;
  }

  getMissionIds(): string[] {
    return Array.from(this.entityMap.keys());
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.rafHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.viewer.dataSources.remove(this.dataSource, true);
    this.entityMap.clear();
    this.pendingUpdates = [];
  }
}
