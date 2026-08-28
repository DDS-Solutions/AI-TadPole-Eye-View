import {
  type CameraPose,
  type EntityReference,
  type RoomIntentState,
  RoomJoinResponseSchema,
  type UserPresence,
  UserPresenceSchema,
} from '@gev/contracts';
import {
  CollabIntentDoc,
  REMOTE_COLLAB_UPDATE_ORIGIN,
  filterRemoteCollabPresences,
  shouldBroadcastCollabUpdate,
} from '@gev/core';
import { runtimeClock } from '../runtimeClock.js';

export interface CollabStoreState {
  isConnected: boolean;
  roomId: string;
  callsign: string;
  role: 'viewer' | 'operator' | 'ai_copilot';
  clientId: string | null;
  roomToken: string | null;
  presences: UserPresence[];
  followLeaderId: string | null;
  intentState: RoomIntentState | null;
  error: string | null;
}

class CollabStore {
  state = $state<CollabStoreState>({
    isConnected: false,
    roomId: 'main-ops-room',
    callsign: `Operator-${Math.floor(100 + Math.random() * 900)}`,
    role: 'operator',
    clientId: null,
    roomToken: null,
    presences: [],
    followLeaderId: null,
    intentState: null,
    error: null,
  });

  public doc: CollabIntentDoc | null = null;
  private ws: WebSocket | null = null;
  private unsubscribeDoc: (() => void) | null = null;
  private lastCursorBroadcast = 0;
  private lastCameraBroadcast = 0;

  async joinRoom(
    roomId = this.state.roomId,
    callsign = this.state.callsign,
    role: 'viewer' | 'operator' | 'ai_copilot' = this.state.role
  ): Promise<void> {
    this.state.roomId = roomId;
    this.state.callsign = callsign;
    this.state.role = role;
    this.state.error = null;

    try {
      const res = await fetch('/api/collab/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, callsign, role }),
      });

      if (!res.ok) {
        throw new Error(`Failed to join room: HTTP ${res.status}`);
      }

      const joinData = RoomJoinResponseSchema.parse(await res.json());
      this.state.clientId = joinData.clientId;
      this.state.role = joinData.role;
      this.state.roomToken = joinData.roomToken;
      this.state.intentState = joinData.initialState;

      // Initialize local CRDT doc
      this.doc = new CollabIntentDoc(roomId);
      this.unsubscribeDoc?.();
      this.unsubscribeDoc = this.doc.onUpdate((update, origin) => {
        try {
          if (this.doc) this.state.intentState = this.doc.toJSON();
          if (
            shouldBroadcastCollabUpdate(origin) &&
            this.ws &&
            this.ws.readyState === WebSocket.OPEN
          ) {
            this.ws.send(update);
          }
        } catch {
          this.state.error = 'Rejected invalid collaborative intent state';
        }
      });

      // Connect to WebSocket room
      const ws = new WebSocket(joinData.wsUrl);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        this.state.isConnected = true;
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Incoming CRDT update
          const bytes = new Uint8Array(event.data);
          if (this.doc) {
            try {
              this.doc.applyValidatedUpdate(bytes, REMOTE_COLLAB_UPDATE_ORIGIN);
            } catch {
              this.state.error = 'Rejected invalid collaborative intent update';
            }
          }
        } else if (typeof event.data === 'string') {
          // Presence list broadcast
          try {
            const parsed = JSON.parse(event.data) as { type?: unknown; presences?: unknown };
            if (parsed.type === 'presence_list') {
              const presences = UserPresenceSchema.array().safeParse(parsed.presences);
              if (presences.success) {
                this.state.presences = filterRemoteCollabPresences(
                  presences.data,
                  this.state.clientId
                );
              }
            }
          } catch {
            // Ignore malformed text frames
          }
        }
      };

      ws.onerror = (e) => {
        this.state.error = `Collab WebSocket error: ${JSON.stringify(e)}`;
      };

      ws.onclose = () => {
        this.state.isConnected = false;
      };
    } catch (err: unknown) {
      this.state.error = err instanceof Error ? err.message : String(err);
    }
  }

  leaveRoom(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.doc = null;
    this.unsubscribeDoc?.();
    this.unsubscribeDoc = null;
    this.state.isConnected = false;
    this.state.clientId = null;
    this.state.roomToken = null;
    this.state.presences = [];
    this.state.followLeaderId = null;
  }

  updateCursor(lat: number, lon: number, altitude_m = 500): void {
    const now = runtimeClock.now();
    // Throttle cursor broadcasts to 50ms (20 Hz)
    if (now - this.lastCursorBroadcast < 50 || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.lastCursorBroadcast = now;

    this.sendJson({
      type: 'presence',
      presence: {
        cursor: { lat, lon, altitude_m },
      },
    });
  }

  updateCamera(camera: CameraPose): void {
    const now = runtimeClock.now();
    // Throttle camera pose broadcasts to 100ms (10 Hz)
    if (now - this.lastCameraBroadcast < 100 || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.lastCameraBroadcast = now;

    this.sendJson({
      type: 'presence',
      presence: {
        camera,
      },
    });
  }

  syncSelectedEntity(entity: EntityReference | null): void {
    if (this.doc) {
      this.doc.setSelectedEntity(entity);
      this.state.intentState = this.doc.toJSON();
    }
  }

  syncLayerToggle(layer: string, enabled: boolean): void {
    if (this.doc) {
      this.doc.setLayerState(layer, enabled);
      this.state.intentState = this.doc.toJSON();
    }
  }

  setFollowLeader(leaderClientId: string | null): void {
    if (leaderClientId !== null && leaderClientId === this.state.clientId) return;
    this.state.followLeaderId = leaderClientId;
    if (this.doc) {
      this.doc.setFollowLeaderId(leaderClientId);
      this.state.intentState = this.doc.toJSON();
    }
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}

export const collabStore = new CollabStore();
