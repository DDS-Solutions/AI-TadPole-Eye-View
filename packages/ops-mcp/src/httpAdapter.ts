import { getMcpToolDefinitions } from '@gev/contracts';
import type { ToolExecutionResult } from '@gev/core';
import {
  type CallToolResult,
  type JsonSchemaType,
  type McpHttpHandler,
  McpServer,
  createMcpHandler,
  fromJsonSchema,
} from '@modelcontextprotocol/server';
import type { OperatorContext } from './context.js';
import { MCP_OPERATOR_TOOL_NAMES, executeOperatorTool } from './tools.js';

export const MCP_HTTP_PROTOCOL_VERSION = '2026-07-28';

export interface GevMcpHttpHandlerOptions {
  context: OperatorContext;
  responseMode?: 'auto' | 'json' | 'sse';
  maxSubscriptions?: number;
  keepAliveMs?: number;
  onerror?: (error: Error) => void;
}

function readOperationId(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || !('operation_id' in metadata)) {
    return undefined;
  }
  const operationId = (metadata as { operation_id?: unknown }).operation_id;
  return typeof operationId === 'string' ? operationId : undefined;
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
export function createGevMcpHttpHandler(options: GevMcpHttpHandlerOptions): McpHttpHandler {
  const definitions = getMcpToolDefinitions(MCP_OPERATOR_TOOL_NAMES);

  return createMcpHandler(
    () => {
      const server = new McpServer({ name: '@gev/ops-mcp', version: '0.1.0' });

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
          },
          async (args, requestContext) => {
            const execution = await executeOperatorTool(options.context, definition.name, args, {
              operation_id: readOperationId(requestContext.mcpReq._meta),
            });
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
}
