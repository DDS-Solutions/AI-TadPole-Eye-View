import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import type { InMemoryRateLimiter } from './middleware/opsAuth.js';
import { type CollabRoomManager, isAllowedWebSocketOrigin } from './routes/collab.js';

export function attachWebSocketCollabServer(
  server: ReturnType<typeof serve>,
  collabRoomManager: CollabRoomManager,
  rateLimiter: InMemoryRateLimiter,
  allowedOrigin = process.env.GEV_CORS_ORIGIN || 'http://localhost:5173'
) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const origin = req.headers.origin;
    if (!isAllowedWebSocketOrigin(origin, allowedOrigin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathMatch = /^\/api\/collab\/room\/([^/]+)$/.exec(url.pathname);
    if (!pathMatch) {
      socket.destroy();
      return;
    }

    const clientId = req.socket.remoteAddress ?? 'unknown-client';
    const rateDecision = rateLimiter.consume('collab-ws-upgrade', clientId, 20);
    if (!rateDecision.allowed) {
      socket.write(
        `HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${rateDecision.retryAfterSeconds}\r\n\r\n`
      );
      socket.destroy();
      return;
    }
    let requestedRoomId: string;
    try {
      requestedRoomId = decodeURIComponent(pathMatch[1] ?? '');
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    // Reject long-lived JWT tokens in URL query params (use single-use ticket or Bearer header)
    if (url.searchParams.has('token')) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const ticket = url.searchParams.get('ticket');
    const authHeader = req.headers.authorization;
    const bearerMatch =
      typeof authHeader === 'string' ? /^Bearer\s+([^\s]+)$/i.exec(authHeader) : null;
    const bearerToken = bearerMatch?.[1];

    if (!ticket && !bearerToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const verified = ticket
      ? collabRoomManager.consumeUpgradeTicket(ticket, requestedRoomId)
      : bearerToken
        ? await collabRoomManager.verifyRoomTokenForRoom(bearerToken, requestedRoomId)
        : null;
    if (!verified) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      collabRoomManager.handleWebSocketPeer(ws, verified);
    });
  });

  return wss;
}
