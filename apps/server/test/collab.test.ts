import { RoomJoinResponseSchema } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';
import { isAllowedWebSocketOrigin } from '../src/routes/collab.js';

describe('Collaborative Rooms API (@gev/server)', () => {
  const opsToken = 'collab-privileged-ops-token';

  type AppContext = ReturnType<typeof createApp>;
  type RequestedRole = 'viewer' | 'operator' | 'ai_copilot';
  interface JoinResponse {
    roomId: string;
    clientId: string;
    roomToken: string;
    role: RequestedRole;
    wsUrl: string;
    initialState: { roomId: string };
  }

  async function joinRoom(
    context: AppContext,
    role: RequestedRole,
    authorization?: string,
    roomId = 'room-test-01'
  ): Promise<JoinResponse> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authorization) headers.Authorization = authorization;

    const response = await context.app.request('/api/collab/join', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        roomId,
        callsign: 'Test-Operator',
        role,
      }),
    });

    expect(response.status).toBe(200);
    return RoomJoinResponseSchema.parse(await response.json()) as JoinResponse;
  }

  it.each(['operator', 'ai_copilot'] as const)(
    'mints the requested %s role only with valid shared credentials',
    async (role) => {
      const context = createApp({ opsAuth: { opsToken, requireAuth: true } });

      try {
        const json = await joinRoom(context, role, `Bearer ${opsToken}`);
        const verifiedToken = await context.collabRoomManager.verifyRoomToken(json.roomToken);

        expect(json.roomId).toBe('room-test-01');
        expect(json.roomToken.split('.').length).toBe(3);
        expect(json.clientId).toBe(verifiedToken?.sub);
        expect(json.role).toBe(role);
        expect(verifiedToken?.role).toBe(role);
        expect(json.wsUrl).toContain('/api/collab/room/room-test-01');
        expect(json.initialState.roomId).toBe('room-test-01');
      } finally {
        context.auditSink.close();
      }
    }
  );

  it.each([
    { label: 'missing credentials', authorization: undefined },
    { label: 'invalid credentials', authorization: 'Bearer invalid-token' },
  ])('downgrades a privileged request with $label to viewer', async ({ authorization }) => {
    const context = createApp({ opsAuth: { opsToken, requireAuth: true } });

    try {
      const json = await joinRoom(context, 'operator', authorization);
      const verifiedToken = await context.collabRoomManager.verifyRoomToken(json.roomToken);

      expect(json.role).toBe('viewer');
      expect(verifiedToken?.role).toBe('viewer');
    } finally {
      context.auditSink.close();
    }
  });

  it('fails privileged role assignment closed when production auth is unconfigured', async () => {
    const context = createApp({ opsAuth: { opsToken: '', requireAuth: true } });

    try {
      const json = await joinRoom(context, 'ai_copilot');
      const verifiedToken = await context.collabRoomManager.verifyRoomToken(json.roomToken);

      expect(json.role).toBe('viewer');
      expect(verifiedToken?.role).toBe('viewer');
    } finally {
      context.auditSink.close();
    }
  });

  it('preserves viewer-only local seed access without minting the requested privilege', async () => {
    const context = createApp({ opsAuth: { opsToken: '', requireAuth: false } });

    try {
      const json = await joinRoom(context, 'operator');
      const verifiedToken = await context.collabRoomManager.verifyRoomToken(json.roomToken);

      expect(json.role).toBe('viewer');
      expect(verifiedToken?.role).toBe('viewer');
    } finally {
      context.auditSink.close();
    }
  });

  it('gates room enumeration and detail behind shared operations auth', async () => {
    const context = createApp({ opsAuth: { opsToken, requireAuth: true } });

    try {
      await joinRoom(context, 'viewer', undefined, 'room-alpha');

      const denied = await context.app.request('/api/collab/rooms');
      expect(denied.status).toBe(401);
      const publicHealth = (await (await context.app.request('/api/health')).json()) as Record<
        string,
        unknown
      >;
      expect(publicHealth).not.toHaveProperty('collab_rooms');

      const res = await context.app.request('/api/collab/rooms', {
        headers: { Authorization: `Bearer ${opsToken}` },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { rooms: Array<{ roomId: string; peerCount: number }> };
      expect(json.rooms.some((r) => r.roomId === 'room-alpha')).toBe(true);

      const detail = await context.app.request('/api/collab/room/room-alpha', {
        headers: { Authorization: `Bearer ${opsToken}` },
      });
      expect(detail.status).toBe(200);
    } finally {
      context.auditSink.close();
    }
  });

  it('GET /api/collab/room/:roomId returns 404 for nonexistent room', async () => {
    const context = createApp({ opsAuth: { opsToken, requireAuth: true } });

    try {
      const res = await context.app.request('/api/collab/room/nonexistent-xyz', {
        headers: { Authorization: `Bearer ${opsToken}` },
      });
      expect(res.status).toBe(404);
    } finally {
      context.auditSink.close();
    }
  });

  it('rejects missing and prefix-spoofed WebSocket Origins while accepting exact local hosts', () => {
    const configured = 'https://console.example.test';
    expect(isAllowedWebSocketOrigin(undefined, configured)).toBe(false);
    expect(isAllowedWebSocketOrigin('http://127.0.0.1.evil.com', configured)).toBe(false);
    expect(isAllowedWebSocketOrigin('http://localhost.evil.com', configured)).toBe(false);
    expect(isAllowedWebSocketOrigin(configured, configured)).toBe(true);
    expect(isAllowedWebSocketOrigin('http://localhost:5180', configured)).toBe(true);
    expect(isAllowedWebSocketOrigin('http://127.0.0.1:5180', configured)).toBe(true);
  });

  it('binds a verified room token to the room named by the WebSocket URL', async () => {
    const context = createApp({ clock: new FrozenClock() });

    try {
      const issued = await context.collabRoomManager.createRoomToken(
        'room-a',
        'Operator',
        'viewer'
      );
      expect(
        await context.collabRoomManager.verifyRoomTokenForRoom(issued.token, 'room-a')
      ).toMatchObject({ roomId: 'room-a', sub: issued.clientId });
      expect(
        await context.collabRoomManager.verifyRoomTokenForRoom(issued.token, 'room-b')
      ).toBeNull();
    } finally {
      context.auditSink.close();
    }
  });

  it('rate-limits voice sessions and room joins per client with an injected clock', async () => {
    const clock = new FrozenClock();
    const context = createApp({
      clock,
      voiceApiKey: 'mock_key',
      resolveClientId: () => 'rate-test-client',
      opsAuth: { opsToken, requireAuth: true },
    });
    const auth = { Authorization: `Bearer ${opsToken}`, 'Content-Type': 'application/json' };

    try {
      for (let count = 0; count < 5; count += 1) {
        const response = await context.app.request('/api/voice/session', {
          method: 'POST',
          headers: auth,
          body: '{}',
        });
        expect(response.status).toBe(200);
      }
      expect(
        (
          await context.app.request('/api/voice/session', {
            method: 'POST',
            headers: auth,
            body: '{}',
          })
        ).status
      ).toBe(429);

      for (let count = 0; count < 20; count += 1) {
        const response = await context.app.request('/api/collab/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: 'rate-room',
            callsign: `Viewer-${count}`,
            role: 'viewer',
          }),
        });
        expect(response.status).toBe(200);
      }
      expect(
        (
          await context.app.request('/api/collab/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId: 'rate-room', callsign: 'Viewer-21', role: 'viewer' }),
          })
        ).status
      ).toBe(429);

      clock.setTime(clock.now() + 60_000);
      expect(
        (
          await context.app.request('/api/voice/session', {
            method: 'POST',
            headers: auth,
            body: '{}',
          })
        ).status
      ).toBe(200);
    } finally {
      context.auditSink.close();
    }
  });
});
