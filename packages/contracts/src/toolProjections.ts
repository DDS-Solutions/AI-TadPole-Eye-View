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
  name: string;
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

export function getMcpToolDefinitions(
  toolNames?: readonly OperatorToolName[]
): McpToolDefinition[] {
  return selectToolNames(toolNames).map((name) => {
    const definition = OPERATOR_TOOLS[name];
    return {
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
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(schema.shape)) {
      const field = value as z.ZodTypeAny;
      properties[key] = zodTypeToJsonSchema(field);
      if (!(field instanceof z.ZodOptional) && !(field instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  if (schema instanceof z.ZodEffects) {
    return zodToJsonSchemaLight(schema.innerType());
  }

  return zodTypeToJsonSchema(schema);
}

function zodTypeToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  const description = field.description ? { description: field.description } : {};

  if (field instanceof z.ZodOptional) {
    return { ...description, ...zodTypeToJsonSchema(field.unwrap()) };
  }
  if (field instanceof z.ZodNullable) {
    return { ...description, ...zodTypeToJsonSchema(field.unwrap()), nullable: true };
  }
  if (field instanceof z.ZodDefault) {
    const innerDefinition = field._def as {
      innerType: z.ZodTypeAny;
      defaultValue: () => unknown;
    };
    const defaultValue = innerDefinition.defaultValue();
    return {
      ...description,
      ...zodTypeToJsonSchema(innerDefinition.innerType),
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
    };
  }
  if (field instanceof z.ZodEffects) {
    return { ...description, ...zodTypeToJsonSchema(field.innerType()) };
  }
  if (field instanceof z.ZodUnion) {
    const options = (field._def as { options: z.ZodTypeAny[] }).options;
    return { ...description, anyOf: options.map(zodTypeToJsonSchema) };
  }
  if (field instanceof z.ZodString) {
    return { ...description, type: 'string' };
  }
  if (field instanceof z.ZodNumber) {
    const result: Record<string, unknown> = { ...description, type: 'number' };
    const checks = (field._def as { checks?: Array<{ kind: string; value: number }> }).checks;
    for (const check of checks ?? []) {
      if (check.kind === 'min') result.minimum = check.value;
      if (check.kind === 'max') result.maximum = check.value;
      if (check.kind === 'int') result.type = 'integer';
    }
    return result;
  }
  if (field instanceof z.ZodBoolean) {
    return { ...description, type: 'boolean' };
  }
  if (field instanceof z.ZodEnum) {
    return { ...description, type: 'string', enum: field.options };
  }
  if (field instanceof z.ZodArray) {
    return { ...description, type: 'array', items: zodTypeToJsonSchema(field.element) };
  }
  if (field instanceof z.ZodObject) {
    return { ...description, ...zodToJsonSchemaLight(field) };
  }
  if (field instanceof z.ZodRecord) {
    return { ...description, type: 'object' };
  }

  return { ...description };
}
