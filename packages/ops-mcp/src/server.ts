import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { OPERATOR_TOOLS, type OperatorToolName } from '@gev/contracts';
import { type OperatorContext, createOperatorContext, executeOperatorTool } from './tools.js';

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
const TOOL_INPUT_SCHEMAS: Record<OperatorToolName, Record<string, unknown>> = {
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
      scene_path: { type: 'string', description: 'File path to load scene from' },
    },
  },
  save_scene: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional scene title' },
      save_path: { type: 'string', description: 'File path to save JSON to' },
    },
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
  fly_to_location: {
    type: 'object',
    properties: {
      lat: { type: 'number', description: 'Latitude (-90 to 90)' },
      lon: { type: 'number', description: 'Longitude (-180 to 180)' },
      altitude_m: { type: 'number', description: 'Altitude in meters' },
      duration_s: { type: 'number', description: 'Flight duration in seconds' },
    },
    required: ['lat', 'lon'],
  },
  toggle_layer: {
    type: 'object',
    properties: {
      layer: { type: 'string', description: 'Layer identifier (e.g. flights, marine, quakes)' },
      enabled: { type: 'boolean', description: 'Enable/disable layer' },
    },
    required: ['layer', 'enabled'],
  },
  select_entity: {
    type: 'object',
    properties: {
      layer: { type: 'string', description: 'Layer identifier' },
      id: { type: 'string', description: 'Entity identifier' },
      track_camera: { type: 'boolean', description: 'Whether to track with camera' },
    },
    required: ['layer', 'id'],
  },
  inspect_telemetry: {
    type: 'object',
    properties: {
      layer: { type: 'string', description: 'Layer identifier' },
      id: { type: 'string', description: 'Entity identifier' },
    },
    required: ['layer', 'id'],
  },
  query_aoi: {
    type: 'object',
    properties: {
      south: { type: 'number', description: 'South latitude bound' },
      west: { type: 'number', description: 'West longitude bound' },
      north: { type: 'number', description: 'North latitude bound' },
      east: { type: 'number', description: 'East longitude bound' },
      layers: { type: 'array', items: { type: 'string' }, description: 'Target layers' },
    },
    required: ['south', 'west', 'north', 'east'],
  },
  set_sim_time: {
    type: 'object',
    properties: {
      offset_s: { type: 'number', description: 'Simulation time offset in seconds' },
      playback_rate: { type: 'number', description: 'Playback speed multiplier' },
    },
    required: ['offset_s'],
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
        const tools = Object.values(OPERATOR_TOOLS).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: TOOL_INPUT_SCHEMAS[tool.name as OperatorToolName] ?? {
            type: 'object',
            properties: {},
          },
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
        const toolName = req.params?.name as OperatorToolName | undefined;
        const toolArgs = (req.params?.arguments as Record<string, unknown>) ?? {};

        if (!toolName || !(toolName in OPERATOR_TOOLS)) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Unknown tool: ${toolName}`,
            },
          };
        }

        try {
          const result = await executeOperatorTool(this.ctx, toolName, toolArgs);
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
