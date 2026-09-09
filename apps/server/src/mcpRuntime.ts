import type { ProviderRegistry } from '@gev/contracts';
import type { SimClock } from '@gev/core';
import type { GovernanceRuntimeContext } from '@gev/governance';
import { createOperatorContext } from '@gev/ops-mcp';
import { createGevMcpHttpHandler } from '@gev/ops-mcp/http';
import type { OpenSkyAdapter } from '@gev/providers';
import type { Hono } from 'hono';
import type { CreateAppOptions } from './appOptions.js';
import {
  type McpHttpRouteLifecycle,
  type McpHttpTestAuthority,
  createMcpHttpRouter,
} from './routes/mcp.js';

export interface McpHttpRuntimeOptions {
  clock: SimClock;
  governanceContext: GovernanceRuntimeContext;
  openSkyAdapter: OpenSkyAdapter;
  providerRegistry: ProviderRegistry;
  enabled?: boolean;
  testAuthority?: McpHttpTestAuthority;
  maxActiveRequests?: number;
  responseMode?: 'auto' | 'json' | 'sse';
}

type McpHttpConfiguration = Pick<
  CreateAppOptions,
  'mcpHttpEnabled' | 'mcpHttpTestAuthority' | 'mcpHttpMaxActiveRequests' | 'mcpHttpResponseMode'
>;

export function createMcpHttpRuntime(
  options: McpHttpRuntimeOptions
): McpHttpRouteLifecycle | undefined {
  const enabled = options.enabled ?? process.env.GEV_MCP_HTTP_ENABLED === '1';
  if (!enabled) return undefined;

  return createMcpHttpRouter({
    handler: createGevMcpHttpHandler({
      context: createOperatorContext({
        governanceContext: options.governanceContext,
        clock: options.clock,
        openSkyAdapter: options.openSkyAdapter,
        providerRegistry: options.providerRegistry,
      }),
      responseMode: options.responseMode,
    }),
    now: () => options.clock.now(),
    testAuthority: process.env.NODE_ENV === 'production' ? undefined : options.testAuthority,
    maxActiveRequests: options.maxActiveRequests,
  });
}

export function mountMcpHttpRuntime(
  app: Hono,
  configuration: McpHttpConfiguration,
  infrastructure: Omit<
    McpHttpRuntimeOptions,
    'enabled' | 'testAuthority' | 'maxActiveRequests' | 'responseMode'
  >
): McpHttpRouteLifecycle | undefined {
  const runtime = createMcpHttpRuntime({
    ...infrastructure,
    enabled: configuration.mcpHttpEnabled,
    testAuthority: configuration.mcpHttpTestAuthority,
    maxActiveRequests: configuration.mcpHttpMaxActiveRequests,
    responseMode: configuration.mcpHttpResponseMode,
  });
  if (runtime) app.route('/mcp', runtime.router);
  return runtime;
}

interface McpHttpServer {
  once(event: 'close', listener: () => void): unknown;
  close(): unknown;
}

export function bindMcpHttpShutdown(
  mcpHttp: McpHttpRouteLifecycle | undefined,
  server: McpHttpServer
): void {
  server.once('close', () => {
    void mcpHttp?.close();
  });

  let shutdownStarted = false;
  const shutdown = () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    void (async () => {
      await mcpHttp?.close();
      server.close();
    })();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
