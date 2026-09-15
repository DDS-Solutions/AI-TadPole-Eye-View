import { createHash } from 'node:crypto';
import {
  TenantIdSchema,
  authorizeTenantResource,
  getAuthorizedOperatorToolNames,
} from '@gev/contracts';
import {
  type McpAuthorizationContext,
  McpAuthorizationContextSchema,
} from '@gev/contracts/mcp-authorization';
import { getMcpHttpToolDefinitions } from '@gev/contracts/mcp-presentation';
import type { ToolExecutionResult } from '@gev/core';
import {
  type AuthInfo,
  type CallToolResult,
  type JsonSchemaType,
  McpServer,
  type McpHttpHandler as SdkMcpHttpHandler,
  createMcpHandler,
  fromJsonSchema,
} from '@modelcontextprotocol/server';
import type { OperatorContext } from './context.js';
import { MCP_OPERATOR_TOOL_NAMES, executeOperatorTool } from './tools.js';

export {
  McpBearerAuthenticationError,
  mcpBearerChallengeResponse,
  verifyMcpBearerAuthorization,
} from './authorization.js';

export const MCP_HTTP_PROTOCOL_VERSION = '2026-07-28';

export interface GevMcpHttpHandlerOptions {
  context: OperatorContext;
  responseMode?: 'auto' | 'json' | 'sse';
  maxSubscriptions?: number;
  keepAliveMs?: number;
  onerror?: (error: Error) => void;
}

type SdkMcpHttpRequestOptions = NonNullable<Parameters<SdkMcpHttpHandler['fetch']>[1]>;

export interface McpHttpExecutionObserver {
  track(execution: Promise<ToolExecutionResult>): void;
  seal(): void;
}

export interface GevMcpHttpRequestOptions extends SdkMcpHttpRequestOptions {
  executionObserver?: McpHttpExecutionObserver;
}

export interface GevMcpHttpHandler extends Omit<SdkMcpHttpHandler, 'fetch'> {
  fetch(request: Request, options?: GevMcpHttpRequestOptions): Promise<Response>;
}

const GEV_AUTHORIZATION_CONTEXT_KEY = 'gev.authorization_context';

export function toGevMcpAuthInfo(accessToken: string, context: McpAuthorizationContext): AuthInfo {
  const parsed = McpAuthorizationContextSchema.parse(context);
  const authorization = Object.freeze({
    ...parsed,
    scopes: Object.freeze([...parsed.scopes]),
  }) as McpAuthorizationContext;
  return {
    token: accessToken,
    clientId: authorization.principal,
    scopes: [...authorization.scopes],
    expiresAt: authorization.expires_at_epoch_seconds,
    resource: new URL(authorization.resource),
    extra: { [GEV_AUTHORIZATION_CONTEXT_KEY]: authorization },
  };
}

function readAuthorizationContext(authInfo: AuthInfo | undefined): McpAuthorizationContext | null {
  const parsed = McpAuthorizationContextSchema.safeParse(
    authInfo?.extra?.[GEV_AUTHORIZATION_CONTEXT_KEY]
  );
  if (
    !parsed.success ||
    authInfo?.clientId !== parsed.data.principal ||
    authInfo.resource?.href !== parsed.data.resource ||
    authInfo.expiresAt !== parsed.data.expires_at_epoch_seconds ||
    authInfo.scopes.length !== parsed.data.scopes.length ||
    !authInfo.scopes.every((scope, index) => scope === parsed.data.scopes[index])
  ) {
    return null;
  }
  return Object.freeze({
    ...parsed.data,
    scopes: Object.freeze([...parsed.data.scopes]),
  }) as McpAuthorizationContext;
}

function readOperationId(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || !('operation_id' in metadata)) {
    return undefined;
  }
  const operationId = (metadata as { operation_id?: unknown }).operation_id;
  return typeof operationId === 'string' ? operationId : undefined;
}

const MCP_TENANT_METADATA_KEY = 'com.dds-solutions.gev/tenantId';

function readRequestedTenantId(metadata: unknown, fallback: string): string | null {
  if (!metadata || typeof metadata !== 'object' || !(MCP_TENANT_METADATA_KEY in metadata)) {
    return fallback;
  }
  const parsed = TenantIdSchema.safeParse(
    (metadata as Record<string, unknown>)[MCP_TENANT_METADATA_KEY]
  );
  return parsed.success ? parsed.data : null;
}

function tenantScopedTaskRef(authorization: McpAuthorizationContext): string {
  const digest = createHash('sha256')
    .update(`${authorization.tenant_id}\0${authorization.task_ref}`, 'utf8')
    .digest('hex');
  return `tenant:${authorization.tenant_id}:task:${digest}`;
}

function executionMetadata(execution: ToolExecutionResult): Record<string, unknown> {
  return {
    status: execution.status,
    intent_id: execution.intent_id,
    duration_ms: execution.duration_ms,
    replayed: execution.replayed ?? false,
    ...(!execution.success
      ? {
          code: execution.code,
          retryable: execution.retryable ?? false,
          ...(execution.retry_after_ms === undefined
            ? {}
            : { retry_after_ms: execution.retry_after_ms }),
        }
      : {}),
  };
}

function isStructuredContent(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toCallToolResult(execution: ToolExecutionResult): CallToolResult {
  if (!execution.success) {
    return {
      isError: true,
      _meta: { execution: executionMetadata(execution) },
      content: [
        {
          type: 'text',
          text: `Tool execution failed: ${execution.error ?? 'Unknown execution error'}`,
        },
      ],
    };
  }

  if (!isStructuredContent(execution.result)) {
    return {
      isError: true,
      _meta: { execution: executionMetadata(execution) },
      content: [
        {
          type: 'text',
          text: 'Tool execution failed: governed output was not structured content',
        },
      ],
    };
  }

  return {
    structuredContent: execution.result,
    _meta: { execution: executionMetadata(execution) },
    content: [{ type: 'text', text: JSON.stringify(execution.result, null, 2) }],
  };
}

/**
 * Builds the isolated modern HTTP face. The official SDK owns protocol parsing,
 * modern-era validation, JSON/SSE response mechanics, and request cancellation.
 * Domain execution remains exclusively in the shared governed executor.
 */
export function createGevMcpHttpHandler(options: GevMcpHttpHandlerOptions): GevMcpHttpHandler {
  const executionObservers = new WeakMap<Request, McpHttpExecutionObserver>();
  const handler = createMcpHandler(
    (requestContext) => {
      const authorization = readAuthorizationContext(requestContext.authInfo);
      const executionObserver = requestContext.requestInfo
        ? executionObservers.get(requestContext.requestInfo)
        : undefined;
      const server = new McpServer(
        { name: '@gev/ops-mcp', version: '0.1.0' },
        authorization ? { capabilities: { tools: { listChanged: false } } } : undefined
      );
      const authorizedToolNames = authorization
        ? getAuthorizedOperatorToolNames(authorization.scopes, MCP_OPERATOR_TOOL_NAMES)
        : [];
      const definitions = getMcpHttpToolDefinitions(authorizedToolNames);

      for (const definition of definitions) {
        const inputSchema = fromJsonSchema<Record<string, unknown>>(
          definition.inputSchema as JsonSchemaType
        );
        const outputSchema = fromJsonSchema<Record<string, unknown>>(
          definition.outputSchema as JsonSchemaType
        );

        server.registerTool(
          definition.name,
          {
            description: definition.description,
            inputSchema,
            outputSchema,
            annotations: definition.annotations,
          },
          async (args, requestContext) => {
            if (!authorization) throw new Error('MCP identity is unavailable');
            const requestedTenantId = readRequestedTenantId(
              requestContext.mcpReq._meta,
              authorization.tenant_id
            );
            const ownership = requestedTenantId
              ? authorizeTenantResource(authorization, {
                  tenant_id: requestedTenantId,
                  allowed_roles: ['ai_copilot'],
                })
              : { allowed: false as const };
            if (!ownership.allowed) throw new Error('MCP tenant resource ownership denied');
            const executionPromise = executeOperatorTool(options.context, definition.name, args, {
              principal: authorization.principal,
              tenant_id: authorization.tenant_id,
              identity: authorization,
              authority_task_ref: authorization.task_ref,
              task_ref: tenantScopedTaskRef(authorization),
              operation_id: readOperationId(requestContext.mcpReq._meta),
              signal: requestContext.mcpReq.signal,
            });
            executionObserver?.track(executionPromise);
            const execution = await executionPromise;
            return toCallToolResult(execution);
          }
        );
      }

      return server;
    },
    {
      legacy: 'reject',
      responseMode: options.responseMode ?? 'auto',
      maxSubscriptions: options.maxSubscriptions ?? 0,
      keepAliveMs: options.keepAliveMs ?? 15_000,
      onerror: options.onerror,
    }
  );

  return {
    bus: handler.bus,
    notify: handler.notify,
    close: handler.close,
    fetch: async (request, requestOptions) => {
      const observer = requestOptions?.executionObserver;
      if (observer) executionObservers.set(request, observer);
      try {
        return await handler.fetch(request, {
          ...(requestOptions?.authInfo ? { authInfo: requestOptions.authInfo } : {}),
          ...(requestOptions?.parsedBody === undefined
            ? {}
            : { parsedBody: requestOptions.parsedBody }),
        });
      } finally {
        executionObservers.delete(request);
        observer?.seal();
      }
    },
  };
}
