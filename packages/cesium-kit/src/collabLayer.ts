import type { UserPresence } from '@gev/contracts';
import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  HeightReference,
  VerticalOrigin,
} from 'cesium';
import { BaseLayerController, type BaseLayerOptions } from './baseLayer.js';

export interface CollabLayerOptions extends BaseLayerOptions {
  localClientId?: string;
  onFollowLeaderUpdated?: (leaderId: string | null) => void;
}

/**
 * Tactical Collaborative Presence & Remote Cursor Layer Controller (PLAN.md §9 T2).
 * Renders remote operator cursors, callsign billboards, and follow-leader camera sync.
 */
export class CollabLayerController extends BaseLayerController<UserPresence, CollabLayerOptions> {
  private localClientId?: string;
  private followLeaderClientId: string | null = null;

  constructor(options: CollabLayerOptions) {
    super(options, 'collab-presence');
    this.localClientId = options.localClientId;
  }

  /**
   * Update active room user presences.
   */
  updatePresences(presences: UserPresence[]): void {
    // Filter out our own local client cursor so we don't render over ourselves
    const remotePresences = this.localClientId
      ? presences.filter((p) => p.clientId !== this.localClientId)
      : presences;

    this.enqueueUpdates(remotePresences);
  }

  /**
   * Set local camera to follow a specific remote operator/leader.
   */
  setFollowLeader(leaderClientId: string | null): void {
    this.followLeaderClientId = leaderClientId;
  }

  getFollowLeader(): string | null {
    return this.followLeaderClientId;
  }

  protected getEntityId(presence: UserPresence): string {
    return presence.clientId;
  }

  protected processEntity(presence: UserPresence, id: string): void {
    // Follow-leader camera tracking
    if (
      this.followLeaderClientId &&
      presence.clientId === this.followLeaderClientId &&
      presence.camera
    ) {
      this.syncLeaderCamera(presence.camera);
    }

    if (!presence.cursor) {
      const existing = this.entityMap.get(id);
      if (existing) {
        existing.show = false;
      }
      return;
    }

    const position = Cartesian3.fromDegrees(
      presence.cursor.lon,
      presence.cursor.lat,
      presence.cursor.altitude_m ?? 500
    );

    const peerColor = Color.fromCssColorString(presence.color || '#00f0ff');
    let entity = this.entityMap.get(id);

    if (!entity) {
      entity = this.dataSource.entities.add({
        id: `peer-${id}`,
        name: `${presence.callsign} (${presence.role})`,
        position,
        point: {
          pixelSize: 10,
          color: peerColor,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          heightReference: HeightReference.NONE,
        },
        label: {
          text: presence.callsign,
          font: "11px 'JetBrains Mono', 'Fira Code', monospace",
          fillColor: peerColor,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: 2, // FILL_AND_OUTLINE
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -12),
          heightReference: HeightReference.NONE,
        },
        properties: {
          clientId: presence.clientId,
          callsign: presence.callsign,
          role: presence.role,
          lastSeenTs: presence.lastSeenTs,
        },
      });
      this.entityMap.set(id, entity);
    } else {
      entity.show = true;
      entity.position = new ConstantPositionProperty(position);
      if (entity.label) {
        entity.label.text = new ConstantProperty(presence.callsign);
      }
      if (entity.properties) {
        entity.properties.merge(presence);
      }
    }
  }

  private syncLeaderCamera(camera: NonNullable<UserPresence['camera']>): void {
    if (this.isDestroyed || !this.viewer.camera) return;

    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(camera.longitude, camera.latitude, camera.altitude),
      orientation: {
        heading: camera.heading ? (camera.heading * Math.PI) / 180 : 0,
        pitch: camera.pitch ? (camera.pitch * Math.PI) / 180 : -Math.PI / 2,
        roll: camera.roll ? (camera.roll * Math.PI) / 180 : 0,
      },
    });
  }
}
