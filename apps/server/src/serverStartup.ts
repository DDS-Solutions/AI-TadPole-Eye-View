import { serve } from '@hono/node-server';
import { bindMcpHttpShutdown } from './mcpRuntime.js';
import { resolveServerClockFromEnvironment } from './serverClock.js';
import { attachWebSocketCollabServer } from './websocketCollab.js';

type CreateApplication = typeof import('./index.js').createApp;

/** Starts the standalone process; application composition remains testable in index.ts. */
export function startStandaloneServer(createApplication: CreateApplication): void {
  const { app, collabRoomManager, rateLimiter, mcpHttp, governanceContext } = createApplication({
    clock: resolveServerClockFromEnvironment(),
  });
  const reaper = governanceContext.startReaper(30_000);
  const server = serve({
    fetch: app.fetch,
    port: Number(process.env.PORT) || 3000,
    hostname: process.env.GEV_HOST || '127.0.0.1',
  });

  attachWebSocketCollabServer(server, collabRoomManager, rateLimiter);
  bindMcpHttpShutdown(mcpHttp, server);
  server.once('close', () => {
    reaper.stop();
  });
}
