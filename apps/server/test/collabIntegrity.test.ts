import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { CollabIntentDoc, FrozenClock } from '@gev/core';
import type { serve } from '@hono/node-server';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { attachWebSocketCollabServer } from '../src/index.js';
import { InMemoryRateLimiter } from '../src/middleware/opsAuth.js';
import { CollabRoomManager } from '../src/routes/collab.js';

class FakeWebSocket extends EventEmitter {
  readyState = 1;
  readonly sent: unknown[] = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
    this.readyState = 3;
  }
}

class FakeDuplex {
  readonly writes: string[] = [];
  destroyed = false;

  write(value: string): void {
    this.writes.push(value);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

describe('collaboration transport integrity', () => {
  it('closes an authorized peer whose update fails staged validation without poisoning the room', () => {
    const manager = new CollabRoomManager(new FrozenClock());
    const sender = new FakeWebSocket();
    const receiver = new FakeWebSocket();
    manager.handleWebSocketPeer(sender as unknown as WebSocket, {
      sub: 'sender',
      callsign: 'Sender',
      roomId: 'safe-room',
      role: 'operator',
    });
    manager.handleWebSocketPeer(receiver as unknown as WebSocket, {
      sub: 'receiver',
      callsign: 'Receiver',
      roomId: 'safe-room',
      role: 'operator',
    });
    const receiverMessageCount = receiver.sent.length;

    const malicious = new CollabIntentDoc('safe-room');
    malicious.setSelectedEntity({ garbage: 1 } as unknown as { layer: string; id: string });
    sender.emit('message', malicious.encodeState(), true);

    expect(sender.closed).toEqual([{ code: 1008, reason: 'Invalid collaborative intent update' }]);
    expect(manager.getRoom('safe-room')?.doc.toJSON().selectedEntity).toBeNull();
    expect(receiver.sent).toHaveLength(receiverMessageCount);
  });

  it('merges presence patches while keeping identity fields server-owned', () => {
    const manager = new CollabRoomManager(new FrozenClock());
    const socket = new FakeWebSocket();
    manager.handleWebSocketPeer(socket as unknown as WebSocket, {
      sub: 'trusted-id',
      callsign: 'Trusted',
      roomId: 'presence-room',
      role: 'viewer',
    });

    socket.emit(
      'message',
      JSON.stringify({ type: 'presence', presence: { cursor: { lat: 1, lon: 2 } } }),
      false
    );
    socket.emit(
      'message',
      JSON.stringify({ type: 'presence', presence: { callsign: 'Spoofed', role: 'operator' } }),
      false
    );

    expect(manager.getRoom('presence-room')?.peers.get('trusted-id')?.presence).toMatchObject({
      clientId: 'trusted-id',
      callsign: 'Trusted',
      role: 'viewer',
      cursor: { lat: 1, lon: 2 },
    });
  });

  it('enforces the 20-per-minute WebSocket upgrade limit on the actual upgrade boundary', () => {
    const server = new EventEmitter();
    const manager = new CollabRoomManager(new FrozenClock());
    const limiter = new InMemoryRateLimiter(new FrozenClock());
    attachWebSocketCollabServer(
      server as unknown as ReturnType<typeof serve>,
      manager,
      limiter,
      'http://localhost:5180'
    );

    const makeAttempt = () => {
      const socket = new FakeDuplex();
      const request = {
        headers: { origin: 'http://localhost:5180' },
        url: '/api/collab/room/rate-room',
        socket: { remoteAddress: '192.0.2.10' },
      } as unknown as IncomingMessage;
      server.emit('upgrade', request, socket as unknown as Duplex, Buffer.alloc(0));
      return socket;
    };

    for (let count = 0; count < 20; count += 1) {
      expect(makeAttempt().writes[0]).toContain('401 Unauthorized');
    }
    expect(makeAttempt().writes[0]).toContain('429 Too Many Requests');
  });
});
