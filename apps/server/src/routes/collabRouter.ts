import { RoomJoinRequestSchema, RoomJoinResponseSchema } from '@gev/contracts';
import { Hono } from 'hono';
import {
  type InMemoryRateLimiter,
  type OpsAuthAdapter,
  createRateLimitMiddleware,
} from '../middleware/opsAuth.js';
import type { CollabRoomManager } from './collab.js';

export interface CollabRouterOptions {
  auth: OpsAuthAdapter;
  rateLimiter?: InMemoryRateLimiter;
  resolveClientId?: Parameters<typeof createRateLimitMiddleware>[1]['resolveClientId'];
  allowedHosts?: readonly string[];
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

    // RBAC & Tenant Isolation: validate asynchronously through shared auth.authenticate (supports OIDC bearerVerifier & opsToken)
    const authDecision = await options.auth.authenticate(
      c.req.header('Authorization'),
      c.req.header('X-GEV-Tenant')
    );
    const tenantId =
      authDecision.kind === 'authenticated' ? authDecision.identity.tenant_id : 'tenant-local';

    let assignedRole: 'viewer' | 'operator' | 'ai_copilot' = req.role;
    if (req.role === 'operator' || req.role === 'ai_copilot') {
      const hasPrivilegedRole =
        authDecision.kind === 'authenticated' &&
        (authDecision.identity.role === 'operator' ||
          authDecision.identity.role === 'tenant_admin' ||
          authDecision.identity.role === 'platform_admin' ||
          authDecision.identity.role === 'ai_copilot');
      if (!hasPrivilegedRole) {
        // Unauthenticated or insufficient-role join downgraded to viewer
        assignedRole = 'viewer';
      }
    }

    const room = manager.getOrCreateRoom(req.roomId, tenantId);
    const { token, clientId, expiresAt } = await manager.createRoomToken(
      req.roomId,
      req.callsign,
      assignedRole,
      tenantId
    );
    const upgradeTicket = manager.createUpgradeTicket({
      sub: clientId,
      callsign: req.callsign,
      roomId: req.roomId,
      tenantId,
      role: assignedRole,
    });

    const rawHost = c.req.header('host');
    let host = '127.0.0.1:3000';
    if (rawHost && /^[a-zA-Z0-9.-]+(:\d+)?$/.test(rawHost)) {
      const hostname = rawHost.split(':')[0]?.toLowerCase() ?? '';
      const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
      if (isLocal || options.allowedHosts?.includes(hostname)) {
        host = rawHost;
      }
    }
    const forwardedProto = c.req.header('x-forwarded-proto')?.toLowerCase();
    const isTls = forwardedProto === 'https' || c.req.url.startsWith('https:');
    const protocol = isTls ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${host}/api/collab/room/${encodeURIComponent(req.roomId)}?ticket=${encodeURIComponent(upgradeTicket)}`;

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
    const tenantId = (c.get('opsTenantId' as never) as string | undefined) ?? 'tenant-local';
    return c.json({
      rooms: manager.listRooms(tenantId),
    });
  });

  // GET /api/collab/room/:roomId
  router.get('/room/:roomId', (c) => {
    const roomId = c.req.param('roomId');
    const tenantId = (c.get('opsTenantId' as never) as string | undefined) ?? 'tenant-local';
    const room = manager.getRoom(roomId, tenantId);
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
