import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { OPERATOR_TOOLS } from '@gev/contracts';
import {
  MCP_OPERATOR_TOOL_NAMES,
  type McpOperatorToolName,
  type OperatorContext,
  createOperatorContext,
  executeOperatorTool,
  isMcpOperatorToolName,
} from './tools.js';

export interface McpServerOptions {
  context?: OperatorContext;
  input?: Readable;
  output?: Writable;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** JSON Schema input descriptors for MCP client tool discovery. */
const TOOL_INPUT_SCHEMAS: Record<McpOperatorToolName, Record<string, unknown>> = {
  get_feed_health: {
    type: 'object',
    properties: {
      provider: { type: 'string', description: 'Filter by provider name (e.g. opensky)' },
    },
  },
  get_budget: {
    type: 'object',
    properties: {},
  },
  run_diagnostics: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['all', 'feeds', 'governance', 'memory'],
        description: 'Diagnostic scope to inspect (default: all)',
      },
    },
  },
  load_scene: {
    type: 'object',
    properties: {
      scene_json: { type: 'string', description: 'Raw JSON string of SceneState' },
      scene_path: {
        type: 'string',
        description: 'Root-level .json filename under the configured MCP scene root',
      },
    },
  },
  save_scene: {
    type: 'object',
    properties: {
      save_path: {
        type: 'string',
        description: 'Root-level .json filename under the configured MCP scene root',
      },
    },
    required: ['save_path'],
  },
  tail_logs: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max audit records (1-1000, default: 50)' },
      task_ref: { type: 'string', description: 'Filter by taskRef' },
    },
  },
  set_flag: {
    type: 'object',
    properties: {
      flag: { type: 'string', description: 'Kill switch flag identifier (e.g. opensky.enabled)' },
      enabled: { type: 'boolean', description: 'Enable/disable flag state' },
    },
    required: ['flag', 'enabled'],
  },
};

/**
 * Robust Model Context Protocol (MCP) Server for GEV v2 Operations.
 * Runs over stdio JSON-RPC transport adhering strictly to stdout/stderr separation.
 */
export class GevMcpServer {
  private readonly ctx: OperatorContext;
  private readonly input: Readable;
  private readonly output: Writable;
  private isRunning = false;

  constructor(options: McpServerOptions = {}) {
    this.ctx = options.context ?? createOperatorContext();
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
  }

  /**
   * Starts listening for JSON-RPC messages on the input stream.
   */
  start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    const rl = readline.createInterface({
      input: this.input,
      terminal: false,
    });

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      try {
        const request = JSON.parse(trimmed) as JsonRpcRequest;
        const response = await this.handleRequest(request);
        if (response && request.id !== undefined && request.id !== null) {
          this.sendResponse(response);
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Invalid JSON-RPC request';
        console.error(`[ops-mcp:error] ${errorMsg}`);
        this.sendResponse({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
            data: errorMsg,
          },
        });
      }
    });

    console.error('[ops-mcp] GEV v2 Operator MCP Server started on stdio transport');
  }

  /**
   * Dispatches a parsed JSON-RPC request to the corresponding MCP handler.
   */
  async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = req.id ?? null;

    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: '@gev/ops-mcp',
              version: '0.1.0',
            },
          },
        };

      case 'notifications/initialized':
        return null;

      case 'ping':
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };

      case 'tools/list': {
        const tools = MCP_OPERATOR_TOOL_NAMES.map((name) => OPERATOR_TOOLS[name]).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: TOOL_INPUT_SCHEMAS[tool.name as McpOperatorToolName],
          _metadata: {
            is_mutating: tool.is_mutating,
            is_dangerous: tool.is_dangerous,
            is_cacheable: tool.is_cacheable,
          },
        }));

        return {
          jsonrpc: '2.0',
          id,
          result: { tools },
        };
      }

      case 'tools/call': {
        const requestedToolName = req.params?.name;
        const toolArgs = (req.params?.arguments as Record<string, unknown>) ?? {};

        if (typeof requestedToolName !== 'string' || !(requestedToolName in OPERATOR_TOOLS)) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Unknown tool: ${String(requestedToolName)}`,
            },
          };
        }

        if (!isMcpOperatorToolName(requestedToolName)) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Tool unavailable on local stdio MCP transport: ${requestedToolName}`,
            },
          };
        }

        try {
          const result = await executeOperatorTool(this.ctx, requestedToolName, toolArgs);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            },
          };
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : 'Execution error';
          return {
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Tool execution failed: ${errorMsg}`,
                },
              ],
            },
          };
        }
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${req.method}`,
          },
        };
    }
  }

  /**
   * Writes JSON-RPC response strictly to the output stream followed by newline.
   */
  private sendResponse(res: JsonRpcResponse): void {
    const serialized = JSON.stringify(res);
    this.output.write(`${serialized}\n`);
  }
}
