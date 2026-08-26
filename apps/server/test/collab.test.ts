import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

describe('Collaborative Rooms API (@gev/server)', () => {
  it('POST /api/collab/join mints signed room token with initial intent state', async () => {
    const { app } = createApp();

    const res = await app.request('/api/collab/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: 'room-test-01',
        callsign: 'Spectre-Lead',
        role: 'operator',
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      roomId: string;
      roomToken: string;
      wsUrl: string;
      initialState: { roomId: string };
    };

    expect(json.roomId).toBe('room-test-01');
    expect(json.roomToken).toBeDefined();
    expect(json.roomToken.split('.').length).toBe(3); // JWT format
    expect(json.wsUrl).toContain('/api/collab/room/room-test-01');
    expect(json.initialState.roomId).toBe('room-test-01');
  });

  it('GET /api/collab/rooms lists active rooms', async () => {
    const { app } = createApp();

    // Create a room first
    await app.request('/api/collab/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: 'room-alpha',
        callsign: 'Alpha-1',
      }),
    });

    const res = await app.request('/api/collab/rooms');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { rooms: Array<{ roomId: string; peerCount: number }> };
    expect(json.rooms.some((r) => r.roomId === 'room-alpha')).toBe(true);
  });

  it('GET /api/collab/room/:roomId returns 404 for nonexistent room', async () => {
    const { app } = createApp();
    const res = await app.request('/api/collab/room/nonexistent-xyz');
    expect(res.status).toBe(404);
  });
});
