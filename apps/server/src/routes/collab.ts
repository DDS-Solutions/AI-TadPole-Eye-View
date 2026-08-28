import crypto from 'node:crypto';
import {
  RoomJoinRequestSchema,
  RoomJoinResponseSchema,
  RoomTokenPayloadSchema,
  type UserPresence,
  UserPresencePatchSchema,
} from '@gev/contracts';
import { CollabIntentDoc, type SimClock, SystemClock } from '@gev/core';
import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import type { WebSocket } from 'ws';
import {
  type InMemoryRateLimiter,
  type OpsAuthAdapter,
  createRateLimitMiddleware,
} from '../middleware/opsAuth.js';

// Strong ephemeral secret generated on startup if not explicitly provided in environment
const JWT_SECRET = new TextEncoder().encode(
  process.env.GEV_ROOM_JWT_SECRET || crypto.randomBytes(32).toString('hex')
);

const MAX_ACTIVE_ROOMS = 50;
const MAX_PEERS_PER_ROOM = 20;
const MAX_FRAME_BYTES = 65536; // 64 KB per frame limit
const ROOM_IDLE_TTL_MS = 60 * 60 * 1000; // 1 hour idle TTL

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
  clientId: string;
  callsign: string;
  role: 'viewer' | 'operator' | 'ai_copilot';
  color: string;
  ws?: WebSocket;
  presence?: UserPresence;
}

export interface ActiveRoom {
  roomId: string;
  doc: CollabIntentDoc;
  peers: Map<string, RoomPeer>;
  createdAt: number;
  lastActivityAt: number;
}

export class CollabRoomManager {
  private rooms = new Map<string, ActiveRoom>();

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
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.peers.size === 0 && now - room.lastActivityAt > ROOM_IDLE_TTL_MS) {
        this.rooms.delete(roomId);
      }
    }
  }

  getOrCreateRoom(roomId: string): ActiveRoom {
    this.cleanupIdleRooms();

    let room = this.rooms.get(roomId);
    if (!room) {
      if (this.rooms.size >= MAX_ACTIVE_ROOMS) {
        // Evict oldest empty room if capacity reached
        let oldestKey: string | null = null;
        let oldestTime = Number.POSITIVE_INFINITY;
        for (const [id, r] of this.rooms.entries()) {
          if (r.peers.size === 0 && r.lastActivityAt < oldestTime) {
            oldestTime = r.lastActivityAt;
            oldestKey = id;
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
        doc: new CollabIntentDoc(roomId),
        peers: new Map(),
        createdAt: this.clock.now(),
        lastActivityAt: this.clock.now(),
      };
      this.rooms.set(roomId, room);
    }
    room.lastActivityAt = this.clock.now();
    return room;
  }

  getRoom(roomId: string): ActiveRoom | undefined {
    return this.rooms.get(roomId);
  }

  listRooms(): Array<{ roomId: string; peerCount: number; lastActivityAt: number }> {
    return Array.from(this.rooms.values()).map((r) => ({
      roomId: r.roomId,
      peerCount: r.peers.size,
      lastActivityAt: r.lastActivityAt,
    }));
  }

  async createRoomToken(
    roomId: string,
    callsign: string,
    role: 'viewer' | 'operator' | 'ai_copilot'
  ): Promise<{ token: string; clientId: string; expiresAt: number }> {
    const issuedAt = Math.floor(this.clock.now() / 1000);
    const expiresAt = issuedAt + 3600; // 1 hour
    const clientId = `usr_${crypto.randomUUID().slice(0, 8)}`;
    const token = await new SignJWT({
      sub: clientId,
      callsign,
      roomId,
      role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(JWT_SECRET);

    return { token, clientId, expiresAt };
  }

  async verifyRoomToken(token: string): Promise<{
    sub: string;
    callsign: string;
    roomId: string;
    role: 'viewer' | 'operator' | 'ai_copilot';
  } | null> {
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
        role: parsed.data.role,
      };
    } catch {
      return null;
    }
  }

  async verifyRoomTokenForRoom(
    token: string,
    requestedRoomId: string
  ): ReturnType<CollabRoomManager['verifyRoomToken']> {
    const payload = await this.verifyRoomToken(token);
    return payload?.roomId === requestedRoomId ? payload : null;
  }

  handleWebSocketPeer(
    ws: WebSocket,
    tokenPayload: {
      sub: string;
      callsign: string;
      roomId: string;
      role: 'viewer' | 'operator' | 'ai_copilot';
    }
  ) {
    const room = this.getOrCreateRoom(tokenPayload.roomId);
    if (room.peers.size >= MAX_PEERS_PER_ROOM) {
      ws.close(1008, 'Room peer capacity exceeded');
      return;
    }

    const clientId = tokenPayload.sub;
    const peerColors = ['#00f0ff', '#ff0055', '#39ff14', '#ffe600', '#bf00ff', '#ff8800'];
    const assignedColor = peerColors[room.peers.size % peerColors.length] ?? '#00f0ff';

    const peer: RoomPeer = {
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

    room.peers.set(clientId, peer);

    // 1. Send initial full CRDT state (binary)
    const initialBinaryState = room.doc.encodeState();
    if (ws.readyState === 1) {
      ws.send(initialBinaryState);
    }

    // 2. Broadcast presence sync to all peers
    this.broadcastPresence(room);

    // 3. Handle incoming frames with strict RBAC and schema guards
    ws.on('message', (data: unknown, isBinary: boolean) => {
      room.lastActivityAt = this.clock.now();

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
        // RBAC: Reject binary CRDT mutations from viewers
        if (peer.role === 'viewer') {
          // Drop unauthorized mutation from viewer
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

        // Broadcast binary update to all OTHER peers in the room
        for (const [peerId, otherPeer] of room.peers.entries()) {
          if (peerId !== clientId && otherPeer.ws && otherPeer.ws.readyState === 1) {
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
      room.peers.delete(clientId);
      this.broadcastPresence(room);
    });
  }

  private broadcastPresence(room: ActiveRoom): void {
    const presences = Array.from(room.peers.values())
      .map((p) => p.presence)
      .filter(Boolean);

    const payload = JSON.stringify({
      type: 'presence_list',
      presences,
    });

    for (const peer of room.peers.values()) {
      if (peer.ws && peer.ws.readyState === 1) {
        peer.ws.send(payload);
      }
    }
  }
}

export interface CollabRouterOptions {
  auth: OpsAuthAdapter;
  rateLimiter?: InMemoryRateLimiter;
  resolveClientId?: Parameters<typeof createRateLimitMiddleware>[1]['resolveClientId'];
}

export function createCollabRouter(manager: CollabRoomManager, options: CollabRouterOptions) {
  const router = new Hono();

  router.use('/rooms', options.auth.middleware());
  router.use('/room/*', options.auth.middleware());
  if (options.rateLimiter && options.resolveClientId) {
    router.use(
      '/join',
      createRateLimitMiddleware(options.rateLimiter, {
        bucket: 'collab-join',
        limit: 20,
        resolveClientId: options.resolveClientId,
      })
    );
  }

  // POST /api/collab/join
  router.post('/join', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON request body' }, 400);
    }

    const parsed = RoomJoinRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid room join request' }, 400);
    }
    const req = parsed.data;

    // RBAC: Check authorization for privileged roles (operator, ai_copilot)
    let assignedRole: 'viewer' | 'operator' | 'ai_copilot' = req.role;
    if (req.role === 'operator' || req.role === 'ai_copilot') {
      const authDecision = options.auth.authorize(c.req.header('Authorization'));
      if (authDecision.kind !== 'authenticated') {
        // Unauthenticated join downgraded to viewer
        assignedRole = 'viewer';
      }
    }

    const room = manager.getOrCreateRoom(req.roomId);
    const { token, clientId, expiresAt } = await manager.createRoomToken(
      req.roomId,
      req.callsign,
      assignedRole
    );

    const host = c.req.header('host') || '127.0.0.1:3000';
    const protocol = c.req.url.startsWith('https') ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${host}/api/collab/room/${encodeURIComponent(req.roomId)}?token=${encodeURIComponent(token)}`;

    return c.json(
      RoomJoinResponseSchema.parse({
        roomId: req.roomId,
        clientId,
        roomToken: token,
        role: assignedRole,
        wsUrl,
        expiresAt,
        initialState: room.doc.toJSON(),
      })
    );
  });

  // GET /api/collab/rooms
  router.get('/rooms', (c) => {
    return c.json({
      rooms: manager.listRooms(),
    });
  });

  // GET /api/collab/room/:roomId
  router.get('/room/:roomId', (c) => {
    const roomId = c.req.param('roomId');
    const room = manager.getRoom(roomId);
    if (!room) {
      return c.json({ error: 'Room not found' }, 404);
    }
    return c.json({
      roomId,
      peerCount: room.peers.size,
      state: room.doc.toJSON(),
    });
  });

  return router;
}
