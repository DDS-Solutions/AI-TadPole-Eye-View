import { describe, expect, it } from 'vitest';
import {
  MCP_TOOL_PRESENTATION_POLICY,
  type McpToolAnnotations,
  getMcpHttpToolDefinitions,
} from '../src/mcpPresentation.js';
import { OPERATOR_TOOLS, type OperatorToolName, getMcpToolDefinitions } from '../src/tools.js';

const EXPECTED_ANNOTATIONS = {
  get_feed_health: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  get_budget: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run_diagnostics: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  load_scene: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  save_scene: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  tail_logs: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  set_flag: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  fly_to_location: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  toggle_layer: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  select_entity: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inspect_telemetry: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  query_aoi: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  set_sim_time: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const satisfies Record<OperatorToolName, McpToolAnnotations>;

describe('server-only MCP presentation policy', () => {
  it('defines explicit semantics for every registry tool in canonical order', () => {
    expect(Object.keys(MCP_TOOL_PRESENTATION_POLICY)).toEqual(Object.keys(OPERATOR_TOOLS));
  });

  it.each(Object.keys(OPERATOR_TOOLS) as OperatorToolName[])(
    'projects canonical annotations and schemas for %s',
    (name) => {
      const presentation = getMcpHttpToolDefinitions([name])[0];
      const registryProjection = getMcpToolDefinitions([name])[0];
      expect(presentation).toBeDefined();
      expect(registryProjection).toBeDefined();
      expect(presentation?.annotations).toEqual(EXPECTED_ANNOTATIONS[name]);
      expect(presentation?.annotations.readOnlyHint).toBe(!OPERATOR_TOOLS[name].is_mutating);
      expect(presentation?.inputSchema).toEqual(registryProjection?.inputSchema);
      expect(presentation?.outputSchema).toEqual(registryProjection?.outputSchema);
      expect(presentation && '_metadata' in presentation).toBe(false);
    }
  );

  it('does not equate dangerous approval policy with destructive behavior', () => {
    expect(OPERATOR_TOOLS.set_flag.is_dangerous).toBe(true);
    expect(EXPECTED_ANNOTATIONS.set_flag.destructiveHint).toBe(false);
    expect(OPERATOR_TOOLS.save_scene.is_dangerous).toBe(false);
    expect(EXPECTED_ANNOTATIONS.save_scene.destructiveHint).toBe(true);
  });
});
