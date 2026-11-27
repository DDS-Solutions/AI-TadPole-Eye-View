import crypto from 'node:crypto';
import { RoomTokenPayloadSchema, type UserPresence, UserPresencePatchSchema } from '@gev/contracts';
import { CollabIntentDoc, type SimClock, SystemClock } from '@gev/core';
import { SignJWT, jwtVerify } from 'jose';
import type { WebSocket } from 'ws';

// Strong ephemeral secret generated on startup if not explicitly provided in environment
const JWT_SECRET = new TextEncoder().encode(
  process.env.GEV_ROOM_JWT_SECRET || crypto.randomBytes(32).toString('hex')
);

export const MAX_ACTIVE_ROOMS = 50;
export const MAX_PEERS_PER_ROOM = 20;
export const MAX_FRAME_BYTES = 65536; // 64 KB per frame limit
export const ROOM_IDLE_TTL_MS = 60 * 60 * 1000; // 1 hour idle TTL

export function isAllowedWebSocketOrigin(
  origin: string | undefined,
  allowedOrigin: string
): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const configured = new URL(allowedOrigin);
    if (
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      return false;
    }
    if (parsed.origin === configured.origin) return true;
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

export interface RoomPeer {
  connId: string;
  clientId: string;
  callsign: string;
  role: 'viewer' | 'operator' | 'ai_copilot';
  color: string;
  ws?: WebSocket;
  presence?: UserPresence;
}

export class PeerMap extends Map<string, RoomPeer> {
  findByClientId(clientId: string): RoomPeer | undefined {
    for (const peer of this.values()) {
      if (peer.clientId === clientId) return peer;
    }
    return undefined;
  }
}

export interface ActiveRoom {
  roomId: string;
  tenantId: string;
  doc: CollabIntentDoc;
  peers: PeerMap;
  createdAt: number;
  lastActivityAt: number;
}

export interface VerifiedRoomPayload {
  sub: string;
  callsign: string;
  roomId: string;
  tenantId: string;
  role: 'viewer' | 'operator' | 'ai_copilot';
}

interface UpgradeTicketEntry {
  payload: VerifiedRoomPayload;
  expiresAtMs: number;
}

const UPGRADE_TICKET_TTL_MS = 30_000;

function scopeRoomKey(roomId: string, tenantId: string = 'tenant-local'): string {
  return `${tenantId}\u0000${roomId}`;
}

export class CollabRoomManager {
  private rooms = new Map<string, ActiveRoom>();
  private upgradeTickets = new Map<string, UpgradeTicketEntry>();

  constructor(private readonly clock: SimClock = new SystemClock()) {
    // Periodic eviction of idle rooms every 10 minutes
    if (typeof setInterval !== 'undefined') {
      const interval = setInterval(() => this.cleanupIdleRooms(), 10 * 60 * 1000);
      if (interval && typeof interval.unref === 'function') {
        interval.unref();
      }
    }
  }

  cleanupIdleRooms(): void {
    const now = this.clock.now();
    for (const [key, room] of this.rooms.entries()) {
      if (room.peers.size === 0 && now - room.lastActivityAt > ROOM_IDLE_TTL_MS) {
        this.rooms.delete(key);
      }
    }
    for (const [ticket, entry] of this.upgradeTickets.entries()) {
      if (now > entry.expiresAtMs) {
        this.upgradeTickets.delete(ticket);
      }
    }
  }

  getOrCreateRoom(roomId: string, tenantId: string = 'tenant-local'): ActiveRoom {
    this.cleanupIdleRooms();

    const key = scopeRoomKey(roomId, tenantId);
    let room = this.rooms.get(key);
    if (!room) {
      if (this.rooms.size >= MAX_ACTIVE_ROOMS) {
        // Evict oldest empty room if capacity reached
        let oldestKey: string | null = null;
        let oldestTime = Number.POSITIVE_INFINITY;
        for (const [candidateKey, r] of this.rooms.entries()) {
          if (r.peers.size === 0 && r.lastActivityAt < oldestTime) {
            oldestTime = r.lastActivityAt;
            oldestKey = candidateKey;
          }
        }
        if (oldestKey) {
          this.rooms.delete(oldestKey);
        } else {
          throw new Error('Collab server room capacity exceeded');
        }
      }

      room = {
        roomId,
        tenantId,
        doc: new CollabIntentDoc(roomId),
        peers: new PeerMap(),
        createdAt: this.clock.now(),
        lastActivityAt: this.clock.now(),
      };
      this.rooms.set(key, room);
    }
    room.lastActivityAt = this.clock.now();
    return room;
  }

  getRoom(roomId: string, tenantId: string = 'tenant-local'): ActiveRoom | undefined {
    return this.rooms.get(scopeRoomKey(roomId, tenantId));
  }

  listRooms(
    tenantId?: string
  ): Array<{ roomId: string; tenantId: string; peerCount: number; lastActivityAt: number }> {
    return Array.from(this.rooms.values())
      .filter((r) => (tenantId ? r.tenantId === tenantId : true))
      .map((r) => ({
        roomId: r.roomId,
        tenantId: r.tenantId,
        peerCount: r.peers.size,
        lastActivityAt: r.lastActivityAt,
      }));
  }

  async createRoomToken(
    roomId: string,
    callsign: string,
    role: 'viewer' | 'operator' | 'ai_copilot',
    tenantId: string = 'tenant-local'
  ): Promise<{ token: string; clientId: string; expiresAt: number }> {
    const issuedAt = Math.floor(this.clock.now() / 1000);
    const expiresAt = issuedAt + 3600; // 1 hour
    const clientId = `usr_${crypto.randomUUID().slice(0, 8)}`;
    const token = await new SignJWT({
      sub: clientId,
      callsign,
      roomId,
      tenantId,
      role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(JWT_SECRET);

    return { token, clientId, expiresAt };
  }

  createUpgradeTicket(payload: VerifiedRoomPayload): string {
    const ticket = crypto.randomBytes(24).toString('base64url');
    this.upgradeTickets.set(ticket, {
      payload,
      expiresAtMs: this.clock.now() + UPGRADE_TICKET_TTL_MS,
    });
    return ticket;
  }

  consumeUpgradeTicket(ticket: string, requestedRoomId: string): VerifiedRoomPayload | null {
    const entry = this.upgradeTickets.get(ticket);
    if (!entry) return null;
    this.upgradeTickets.delete(ticket);
    if (this.clock.now() > entry.expiresAtMs) return null;
    if (entry.payload.roomId !== requestedRoomId) return null;
    return entry.payload;
  }

  async verifyRoomToken(token: string): Promise<VerifiedRoomPayload | null> {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET, {
        currentDate: new Date(this.clock.now()),
      });
      const parsed = RoomTokenPayloadSchema.safeParse(payload);
      if (!parsed.success) return null;
      return {
        sub: parsed.data.sub,
        callsign: parsed.data.callsign,
        roomId: parsed.data.roomId,
        tenantId: parsed.data.tenantId,
        role: parsed.data.role,
      };
    } catch {
      return null;
    }
  }

  async verifyRoomTokenForRoom(
    token: string,
    requestedRoomId: string
  ): Promise<VerifiedRoomPayload | null> {
    const payload = await this.verifyRoomToken(token);
    return payload?.roomId === requestedRoomId ? payload : null;
  }

  handleWebSocketPeer(
    ws: WebSocket,
    tokenPayload: {
      sub: string;
      callsign: string;
      roomId: string;
      tenantId?: string;
      role: 'viewer' | 'operator' | 'ai_copilot';
    }
  ) {
    const room = this.getOrCreateRoom(tokenPayload.roomId, tokenPayload.tenantId ?? 'tenant-local');
    if (room.peers.size >= MAX_PEERS_PER_ROOM) {
      ws.close(1008, 'Room peer capacity exceeded');
      return;
    }

    const clientId = tokenPayload.sub;
    const connId = crypto.randomUUID();
    const peerColors = ['#00f0ff', '#ff0055', '#39ff14', '#ffe600', '#bf00ff', '#ff8800'];
    const assignedColor = peerColors[room.peers.size % peerColors.length] ?? '#00f0ff';

    const peer: RoomPeer = {
      connId,
      clientId,
      callsign: tokenPayload.callsign,
      role: tokenPayload.role,
      color: assignedColor,
      ws,
      presence: {
        clientId,
        callsign: tokenPayload.callsign,
        role: tokenPayload.role,
        color: assignedColor,
        lastSeenTs: this.clock.now(),
      },
    };

    room.peers.set(connId, peer);

    // 1. Send initial full CRDT state (binary)
    const initialBinaryState = room.doc.encodeState();
    if (ws.readyState === 1) {
      ws.send(initialBinaryState);
    }

    // 2. Broadcast presence sync to all peers
    this.broadcastPresence(room);

    // 3. Handle incoming frames with strict RBAC and schema guards
    ws.on('message', (data: unknown, isBinary: boolean) => {
      // Enforce frame size limit
      const byteLen =
        typeof data === 'string'
          ? Buffer.byteLength(data)
          : data instanceof Uint8Array || Buffer.isBuffer(data)
            ? data.length
            : 0;

      if (byteLen > MAX_FRAME_BYTES) {
        ws.close(1009, 'Frame size exceeds maximum threshold (64KB)');
        return;
      }

      if (isBinary) {
        // RBAC: Reject binary CRDT mutations from viewers without extending room idle TTL
        if (peer.role === 'viewer') {
          return;
        }

        // Binary Yjs update from authorized operator or copilot
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
        try {
          room.doc.applyValidatedUpdate(bytes, clientId);
        } catch {
          ws.close(1008, 'Invalid collaborative intent update');
          return;
        }

        room.lastActivityAt = this.clock.now();

        // Broadcast binary update to all OTHER peers in the room
        for (const [peerConnId, otherPeer] of room.peers.entries()) {
          if (peerConnId !== connId && otherPeer.ws && otherPeer.ws.readyState === 1) {
            otherPeer.ws.send(bytes);
          }
        }
      } else {
        // Text / JSON presence update
        try {
          const str = typeof data === 'string' ? data : (data as Buffer).toString('utf-8');
          const envelope = JSON.parse(str) as { type?: unknown; presence?: unknown };
          if (envelope.type === 'presence' && envelope.presence) {
            const validatedPresence = UserPresencePatchSchema.safeParse(envelope.presence);
            if (validatedPresence.success) {
              room.lastActivityAt = this.clock.now();
              peer.presence = {
                ...peer.presence,
                ...validatedPresence.data,
                clientId,
                callsign: peer.callsign,
                role: peer.role,
                color: peer.color,
                lastSeenTs: this.clock.now(),
              };
              this.broadcastPresence(room);
            }
          }
        } catch {
          // Ignore invalid frames
        }
      }
    });

    ws.on('close', () => {
      room.peers.delete(connId);
      this.broadcastPresence(room);
    });
  }

  private broadcastPresence(room: ActiveRoom): void {
    const presenceByClient = new Map<string, UserPresence>();
    for (const peer of room.peers.values()) {
      if (!peer.presence) continue;
      const existing = presenceByClient.get(peer.clientId);
      if (!existing || peer.presence.lastSeenTs >= existing.lastSeenTs) {
        presenceByClient.set(peer.clientId, peer.presence);
      }
    }

    const payload = JSON.stringify({
      type: 'presence_list',
      presences: Array.from(presenceByClient.values()),
    });

    for (const peer of room.peers.values()) {
      if (peer.ws && peer.ws.readyState === 1) {
        peer.ws.send(payload);
      }
    }
  }
}

export { type CollabRouterOptions, createCollabRouter } from './collabRouter.js';
