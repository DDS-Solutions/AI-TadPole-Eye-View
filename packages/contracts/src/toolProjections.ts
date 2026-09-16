import { z } from 'zod';
import type { CapabilityScope } from './ports.js';
import {
  OPERATOR_TOOLS,
  OPERATOR_TOOL_REQUIRED_SCOPES,
  type OperatorToolName,
  type ToolMetadata,
} from './toolRegistry.js';

export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface McpToolDefinition {
  name: OperatorToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  _metadata: Pick<
    ToolMetadata,
    | 'is_mutating'
    | 'is_dangerous'
    | 'is_cacheable'
    | 'requires_reservation'
    | 'cost_estimate'
    | 'timeout_ms'
  >;
}

export function getOpenAIToolDefinitions(
  toolNames?: readonly OperatorToolName[]
): OpenAIToolDefinition[] {
  return selectToolNames(toolNames).map((name) => {
    const definition = OPERATOR_TOOLS[name];
    return {
      type: 'function',
      function: {
        name: definition.name,
        description: `${definition.description}${definition.is_mutating ? ' [MUTATING]' : ''}${definition.is_dangerous ? ' [DANGEROUS]' : ''}`,
        parameters: zodToJsonSchemaLight(definition.inputSchema),
      },
    };
  });
}

const mcpToolDefinitionCache = new Map<OperatorToolName, McpToolDefinition>();

export function getMcpToolDefinitions(
  toolNames?: readonly OperatorToolName[]
): McpToolDefinition[] {
  return selectToolNames(toolNames).map((name) => {
    let cached = mcpToolDefinitionCache.get(name);
    if (!cached) {
      const definition = OPERATOR_TOOLS[name];
      cached = {
        name: definition.name,
        description: definition.description,
        inputSchema: zodToJsonSchemaLight(definition.inputSchema),
        outputSchema: zodToJsonSchemaLight(definition.outputSchema),
        _metadata: {
          is_mutating: definition.is_mutating,
          is_dangerous: definition.is_dangerous,
          is_cacheable: definition.is_cacheable,
          requires_reservation: definition.requires_reservation,
          cost_estimate: definition.cost_estimate,
          timeout_ms: definition.timeout_ms,
        },
      };
      mcpToolDefinitionCache.set(name, cached);
    }
    return cached;
  });
}

/** Returns the canonical registry-ordered tool subset authorized by every required scope. */
export function getAuthorizedOperatorToolNames(
  grantedScopes: readonly CapabilityScope[],
  toolNames?: readonly OperatorToolName[]
): OperatorToolName[] {
  const granted = new Set<CapabilityScope>(grantedScopes);
  return selectToolNames(toolNames).filter((name) =>
    OPERATOR_TOOL_REQUIRED_SCOPES[name].every((scope) => granted.has(scope))
  );
}

export function getMissingOperatorToolScopes(
  name: OperatorToolName,
  grantedScopes: readonly CapabilityScope[]
): CapabilityScope[] {
  const granted = new Set<CapabilityScope>(grantedScopes);
  return OPERATOR_TOOL_REQUIRED_SCOPES[name].filter((scope) => !granted.has(scope));
}

function selectToolNames(toolNames?: readonly OperatorToolName[]): OperatorToolName[] {
  return toolNames ? [...toolNames] : (Object.keys(OPERATOR_TOOLS) as OperatorToolName[]);
}

function zodToJsonSchemaLight(schema: z.ZodTypeAny): Record<string, unknown> {
  const toJSONSchemaFn = (
    z as unknown as {
      toJSONSchema?: (s: unknown) => Record<string, unknown>;
    }
  ).toJSONSchema;

  if (typeof toJSONSchemaFn === 'function') {
    const result = toJSONSchemaFn(schema);
    const clean = { ...result };
    delete clean['$schema'];
    return clean;
  }

  throw new Error('Tool schema projection failed: z.toJSONSchema is not available');
}
