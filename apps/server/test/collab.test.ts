import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

describe('Collaborative Rooms API (@gev/server)', () => {
  const opsToken = 'collab-privileged-ops-token';

  type AppContext = ReturnType<typeof createApp>;
  type RequestedRole = 'viewer' | 'operator' | 'ai_copilot';
  interface JoinResponse {
    roomId: string;
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
    return (await response.json()) as JoinResponse;
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

  it('GET /api/collab/rooms lists active rooms', async () => {
    const context = createApp();

    try {
      await joinRoom(context, 'viewer', undefined, 'room-alpha');

      const res = await context.app.request('/api/collab/rooms');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { rooms: Array<{ roomId: string; peerCount: number }> };
      expect(json.rooms.some((r) => r.roomId === 'room-alpha')).toBe(true);
    } finally {
      context.auditSink.close();
    }
  });

  it('GET /api/collab/room/:roomId returns 404 for nonexistent room', async () => {
    const context = createApp();

    try {
      const res = await context.app.request('/api/collab/room/nonexistent-xyz');
      expect(res.status).toBe(404);
    } finally {
      context.auditSink.close();
    }
  });
});
