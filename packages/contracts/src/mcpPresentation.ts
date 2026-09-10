import { getMcpToolDefinitions } from './toolProjections.js';
import { OPERATOR_TOOLS, type OperatorToolName } from './toolRegistry.js';

export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

type ExplicitMcpToolSemantics = Omit<McpToolAnnotations, 'readOnlyHint'>;

/**
 * Server-only MCP presentation policy. Mutation truth remains registry-owned;
 * the other hints are explicit because they cannot be inferred from governance flags.
 */
export const MCP_TOOL_PRESENTATION_POLICY = {
  get_feed_health: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  get_budget: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run_diagnostics: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  load_scene: {
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  save_scene: {
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  tail_logs: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  set_flag: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  fly_to_location: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  toggle_layer: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  select_entity: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inspect_telemetry: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  query_aoi: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  set_sim_time: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const satisfies Record<OperatorToolName, ExplicitMcpToolSemantics>;

export interface McpHttpToolDefinition {
  name: OperatorToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
}

/** Projects canonical schemas plus truthful standard hints for an authorized HTTP subset. */
export function getMcpHttpToolDefinitions(
  toolNames: readonly OperatorToolName[]
): McpHttpToolDefinition[] {
  return getMcpToolDefinitions(toolNames).map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    annotations: {
      readOnlyHint: !OPERATOR_TOOLS[definition.name].is_mutating,
      ...MCP_TOOL_PRESENTATION_POLICY[definition.name],
    },
  }));
}
