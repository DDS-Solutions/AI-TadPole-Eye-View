import { z } from 'zod';
import { AuditEntrySchema } from './ports.js';
import {
  ProviderHealthSchema,
  ProviderImplementationStateSchema,
  ProviderRegistryIdSchema,
  ProviderRuntimeModeSchema,
} from './providerRegistry.js';
import { SelectedEntity } from './scene.js';

export const ToolMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  is_mutating: z.boolean(),
  is_dangerous: z.boolean(),
  is_cacheable: z.boolean(),
});
export type ToolMetadata = z.infer<typeof ToolMetadataSchema>;

// 1. get_feed_health
export const GetFeedHealthInputSchema = z.object({
  provider: z.string().optional(),
});
export type GetFeedHealthInput = z.infer<typeof GetFeedHealthInputSchema>;

export const FeedHealthItemSchema = z.object({
  feed: ProviderRegistryIdSchema,
  provider: ProviderRegistryIdSchema,
  implementation: ProviderImplementationStateSchema,
  mode: ProviderRuntimeModeSchema,
  status: ProviderHealthSchema,
  last_success_ts: z.number().finite().nonnegative().nullable(),
  error_rate: z.number().finite().min(0).max(1).nullable(),
  quota_remaining: z.number().finite().nonnegative().nullable(),
  ttl_tier_s: z.number().finite().nonnegative().nullable(),
});
export type FeedHealthItem = z.infer<typeof FeedHealthItemSchema>;

export const GetFeedHealthOutputSchema = z.object({
  feeds: z.array(FeedHealthItemSchema),
});
export type GetFeedHealthOutput = z.infer<typeof GetFeedHealthOutputSchema>;

// 2. get_budget
export const GetBudgetInputSchema = z.object({});
export type GetBudgetInput = z.infer<typeof GetBudgetInputSchema>;

export const GetBudgetOutputSchema = z.object({
  cap_usd: z.number().finite().nonnegative(),
  spent_usd: z.number().finite().nonnegative(),
  remaining_usd: z.number().finite().nonnegative(),
  stasis_active: z.boolean(),
  trip_reason: z.string().optional(),
});
export type GetBudgetOutput = z.infer<typeof GetBudgetOutputSchema>;

// 3. run_diagnostics
export const RunDiagnosticsInputSchema = z.object({
  scope: z.enum(['all', 'feeds', 'governance', 'memory']).default('all').optional(),
});
export type RunDiagnosticsInput = z.infer<typeof RunDiagnosticsInputSchema>;

export const DiagnosticCheckSchema = z.object({
  name: z.string(),
  status: z.enum(['pass', 'warn', 'fail']),
  message: z.string().optional(),
});
export type DiagnosticCheck = z.infer<typeof DiagnosticCheckSchema>;

export const RunDiagnosticsOutputSchema = z.object({
  status: z.enum(['ok', 'warn', 'fail']),
  timestamp: z.number().finite(),
  checks: z.array(DiagnosticCheckSchema),
});
export type RunDiagnosticsOutput = z.infer<typeof RunDiagnosticsOutputSchema>;

// 4. load_scene
export const LoadSceneInputSchema = z
  .object({
    scene_json: z.string().min(1).optional(),
    scene_path: z.string().min(1).optional(),
  })
  .strict()
  .refine((data) => (data.scene_json === undefined) !== (data.scene_path === undefined), {
    message: 'Exactly one of scene_json or scene_path must be provided',
  });
export type LoadSceneInput = z.infer<typeof LoadSceneInputSchema>;

export const SceneToolSummarySchema = z.object({
  version: z.number().finite(),
  layer_count: z.number().int().nonnegative(),
  enabled_layer_count: z.number().int().nonnegative(),
  aoi_count: z.number().int().nonnegative(),
  camera_altitude: z.number().finite().nonnegative(),
  selected_entity: SelectedEntity,
});
export type SceneToolSummary = z.infer<typeof SceneToolSummarySchema>;

export const LoadSceneOutputSchema = z.object({
  loaded: z.boolean(),
  source: z.enum(['inline', 'file']),
  scene_path: z.string().optional(),
  summary: SceneToolSummarySchema,
});
export type LoadSceneOutput = z.infer<typeof LoadSceneOutputSchema>;

// 5. save_scene
export const SaveSceneInputSchema = z
  .object({
    save_path: z.string().min(1),
  })
  .strict();
export type SaveSceneInput = z.infer<typeof SaveSceneInputSchema>;

export const SaveSceneSummarySchema = SceneToolSummarySchema;
export type SaveSceneSummary = z.infer<typeof SaveSceneSummarySchema>;

export const SaveSceneOutputSchema = z.object({
  saved: z.boolean(),
  scene_path: z.string(),
  summary: SaveSceneSummarySchema,
});
export type SaveSceneOutput = z.infer<typeof SaveSceneOutputSchema>;

// 6. tail_logs
export const TailLogsInputSchema = z.object({
  limit: z.number().finite().positive().max(1000).default(50).optional(),
  task_ref: z.string().optional(),
});
export type TailLogsInput = z.infer<typeof TailLogsInputSchema>;

export const TailLogsOutputSchema = z.object({
  entries: z.array(AuditEntrySchema),
});
export type TailLogsOutput = z.infer<typeof TailLogsOutputSchema>;

// 7. set_flag
export const SetFlagInputSchema = z.object({
  flag: z.string(),
  enabled: z.boolean(),
});
export type SetFlagInput = z.infer<typeof SetFlagInputSchema>;

export const SetFlagOutputSchema = z.object({
  flag: z.string(),
  enabled: z.boolean(),
  updated: z.boolean(),
});
export type SetFlagOutput = z.infer<typeof SetFlagOutputSchema>;

// 8. fly_to_location (OSINT domain actuator)
export const FlyToLocationInputSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  altitude_m: z.number().finite().positive().default(500000).optional(),
  duration_s: z.number().finite().positive().default(2).optional(),
});
export type FlyToLocationInput = z.infer<typeof FlyToLocationInputSchema>;

export const FlyToLocationOutputSchema = z.object({
  moved: z.boolean(),
  target: z.object({
    lat: z.number(),
    lon: z.number(),
    altitude_m: z.number(),
  }),
});
export type FlyToLocationOutput = z.infer<typeof FlyToLocationOutputSchema>;

// 9. toggle_layer (OSINT domain actuator)
export const ToggleLayerInputSchema = z.object({
  layer: z.string().min(1),
  enabled: z.boolean(),
});
export type ToggleLayerInput = z.infer<typeof ToggleLayerInputSchema>;

export const ToggleLayerOutputSchema = z.object({
  layer: z.string(),
  enabled: z.boolean(),
  updated: z.boolean(),
});
export type ToggleLayerOutput = z.infer<typeof ToggleLayerOutputSchema>;

// 10. select_entity (OSINT domain actuator)
export const SelectEntityInputSchema = z.object({
  layer: z.string().min(1),
  id: z.string().min(1),
  track_camera: z.boolean().default(false).optional(),
});
export type SelectEntityInput = z.infer<typeof SelectEntityInputSchema>;

export const SelectEntityOutputSchema = z.object({
  selected: z.boolean(),
  layer: z.string(),
  id: z.string(),
  entity_found: z.boolean(),
});
export type SelectEntityOutput = z.infer<typeof SelectEntityOutputSchema>;

// 11. inspect_telemetry (OSINT telemetry query)
export const InspectTelemetryInputSchema = z.object({
  layer: z.string().min(1),
  id: z.string().min(1),
});
export type InspectTelemetryInput = z.infer<typeof InspectTelemetryInputSchema>;

export const InspectTelemetryOutputSchema = z.object({
  layer: z.string(),
  id: z.string(),
  found: z.boolean(),
  data: z.record(z.unknown()).optional(),
});
export type InspectTelemetryOutput = z.infer<typeof InspectTelemetryOutputSchema>;

// 12. query_aoi (OSINT spatial query)
export const QueryAoiInputSchema = z.object({
  south: z.number().finite().min(-90).max(90),
  west: z.number().finite().min(-180).max(180),
  north: z.number().finite().min(-90).max(90),
  east: z.number().finite().min(-180).max(180),
  layers: z.array(z.string()).optional(),
});
export type QueryAoiInput = z.infer<typeof QueryAoiInputSchema>;

export const QueryAoiOutputSchema = z.object({
  total_entities: z.number().finite().nonnegative(),
  counts_by_layer: z.record(z.number()),
  bounds: z.object({
    south: z.number(),
    west: z.number(),
    north: z.number(),
    east: z.number(),
  }),
});
export type QueryAoiOutput = z.infer<typeof QueryAoiOutputSchema>;

// 13. set_sim_time (Sim-clock control)
export const SetSimTimeInputSchema = z.object({
  offset_s: z.number().finite(),
  playback_rate: z.number().finite().positive().default(1).optional(),
});
export type SetSimTimeInput = z.infer<typeof SetSimTimeInputSchema>;

export const SetSimTimeOutputSchema = z.object({
  sim_time_offset_s: z.number().finite(),
  playback_rate: z.number().finite(),
  updated: z.boolean(),
});
export type SetSimTimeOutput = z.infer<typeof SetSimTimeOutputSchema>;

export type OperatorToolDefinition<
  TName extends string,
  TIn extends z.ZodTypeAny,
  TOut extends z.ZodTypeAny,
> = {
  name: TName;
  description: string;
  is_mutating: boolean;
  is_dangerous: boolean;
  is_cacheable: boolean;
  inputSchema: TIn;
  outputSchema: TOut;
};

/**
 * Shared registry of standard operator and console tool definitions with governance flags.
 * Serves Voice Agent, in-app Co-User, and Operator MCP Server.
 */
export const OPERATOR_TOOLS = {
  get_feed_health: {
    name: 'get_feed_health',
    description: 'Query provider registry health and observed quota data where available',
    is_mutating: false,
    is_dangerous: false,
    is_cacheable: true,
    inputSchema: GetFeedHealthInputSchema,
    outputSchema: GetFeedHealthOutputSchema,
  },
  get_budget: {
    name: 'get_budget',
    description: 'Check cost governor budget consumption, limits, and STASIS lock state',
    is_mutating: false,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: GetBudgetInputSchema,
    outputSchema: GetBudgetOutputSchema,
  },
  run_diagnostics: {
    name: 'run_diagnostics',
    description: 'Execute verified local fixture, memory, audit, and governance self-checks',
    is_mutating: false,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: RunDiagnosticsInputSchema,
    outputSchema: RunDiagnosticsOutputSchema,
  },
  load_scene: {
    name: 'load_scene',
    description: 'Load a serialized globe scene state (destructive state overwrite)',
    is_mutating: true,
    is_dangerous: true,
    is_cacheable: false,
    inputSchema: LoadSceneInputSchema,
    outputSchema: LoadSceneOutputSchema,
  },
  save_scene: {
    name: 'save_scene',
    description: 'Snapshot current globe state into a reproducible scene file',
    is_mutating: true,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: SaveSceneInputSchema,
    outputSchema: SaveSceneOutputSchema,
  },
  tail_logs: {
    name: 'tail_logs',
    description: 'Query recent audit log intent/outcome entries from SQLite WAL',
    is_mutating: false,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: TailLogsInputSchema,
    outputSchema: TailLogsOutputSchema,
  },
  set_flag: {
    name: 'set_flag',
    description: 'Toggle feature kill-switch flags dynamically',
    is_mutating: true,
    is_dangerous: true,
    is_cacheable: false,
    inputSchema: SetFlagInputSchema,
    outputSchema: SetFlagOutputSchema,
  },
  fly_to_location: {
    name: 'fly_to_location',
    description:
      'Navigate camera to specific geographic latitude, longitude, and altitude on the globe',
    is_mutating: true,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: FlyToLocationInputSchema,
    outputSchema: FlyToLocationOutputSchema,
  },
  toggle_layer: {
    name: 'toggle_layer',
    description:
      'Enable or disable a specific telemetry layer (e.g. flights, marine, quakes, firms, cctv, radio, launches)',
    is_mutating: true,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: ToggleLayerInputSchema,
    outputSchema: ToggleLayerOutputSchema,
  },
  select_entity: {
    name: 'select_entity',
    description: 'Select and track a specific telemetry entity on the 3D globe by ID and layer',
    is_mutating: true,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: SelectEntityInputSchema,
    outputSchema: SelectEntityOutputSchema,
  },
  inspect_telemetry: {
    name: 'inspect_telemetry',
    description:
      'Fetch detailed telemetry and metadata attributes for a specific entity in an active layer',
    is_mutating: false,
    is_dangerous: false,
    is_cacheable: true,
    inputSchema: InspectTelemetryInputSchema,
    outputSchema: InspectTelemetryOutputSchema,
  },
  query_aoi: {
    name: 'query_aoi',
    description: 'Query entity density and counts within an Area of Interest (AOI) bounding box',
    is_mutating: false,
    is_dangerous: false,
    is_cacheable: true,
    inputSchema: QueryAoiInputSchema,
    outputSchema: QueryAoiOutputSchema,
  },
  set_sim_time: {
    name: 'set_sim_time',
    description: 'Adjust global simulation clock offset and replay rate',
    is_mutating: true,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: SetSimTimeInputSchema,
    outputSchema: SetSimTimeOutputSchema,
  },
} as const satisfies Record<string, OperatorToolDefinition<string, z.ZodTypeAny, z.ZodTypeAny>>;

export type OperatorToolName = keyof typeof OPERATOR_TOOLS;

/**
 * OpenAI / OpenRouter Tool Definition Format.
 */
export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Generate OpenAI Realtime / Chat function definitions from the shared OPERATOR_TOOLS registry.
 */
export function getOpenAIToolDefinitions(
  toolNames?: readonly OperatorToolName[]
): OpenAIToolDefinition[] {
  const keys = (toolNames ?? Object.keys(OPERATOR_TOOLS)) as OperatorToolName[];
  return keys.map((key) => {
    const def = OPERATOR_TOOLS[key];
    return {
      type: 'function',
      function: {
        name: def.name,
        description: `${def.description}${def.is_mutating ? ' [MUTATING]' : ''}${def.is_dangerous ? ' [DANGEROUS]' : ''}`,
        parameters: zodToJsonSchemaLight(def.inputSchema),
      },
    };
  });
}

/**
 * Lightweight Zod-to-JSON-Schema converter for tool definitions without external heavy deps.
 */
function zodToJsonSchemaLight(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const field = value as z.ZodTypeAny;
      properties[key] = zodTypeToJsonSchema(field);
      if (!(field instanceof z.ZodOptional) && !(field instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  if (schema instanceof z.ZodEffects) {
    return zodToJsonSchemaLight(schema.innerType());
  }

  return { type: 'object', properties: {} };
}

function zodTypeToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (field.description) {
    result.description = field.description;
  }

  if (field instanceof z.ZodOptional) {
    return { ...result, ...zodTypeToJsonSchema(field.unwrap()) };
  }

  if (field instanceof z.ZodNullable) {
    const inner = zodTypeToJsonSchema(field.unwrap());
    return { ...result, ...inner, nullable: true };
  }

  if (field instanceof z.ZodDefault) {
    const innerDef = field._def as { innerType: z.ZodTypeAny; defaultValue: () => unknown };
    const inner = zodTypeToJsonSchema(innerDef.innerType);
    let defaultVal: unknown;
    try {
      defaultVal = innerDef.defaultValue();
    } catch {
      // Ignore if default evaluation throws
    }
    return {
      ...result,
      ...inner,
      ...(defaultVal !== undefined ? { default: defaultVal } : {}),
    };
  }

  if (field instanceof z.ZodUnion) {
    const options = (field._def as { options: z.ZodTypeAny[] }).options;
    return {
      ...result,
      anyOf: options.map((opt) => zodTypeToJsonSchema(opt)),
    };
  }

  if (field instanceof z.ZodString) {
    return { ...result, type: 'string' };
  }

  if (field instanceof z.ZodNumber) {
    const numSchema: Record<string, unknown> = { ...result, type: 'number' };
    const checks = (field._def as { checks?: Array<{ kind: string; value: number }> }).checks;
    if (checks) {
      for (const check of checks) {
        if (check.kind === 'min') {
          numSchema.minimum = check.value;
        } else if (check.kind === 'max') {
          numSchema.maximum = check.value;
        }
      }
    }
    return numSchema;
  }

  if (field instanceof z.ZodBoolean) {
    return { ...result, type: 'boolean' };
  }

  if (field instanceof z.ZodEnum) {
    return { ...result, type: 'string', enum: field.options };
  }

  if (field instanceof z.ZodArray) {
    return {
      ...result,
      type: 'array',
      items: zodTypeToJsonSchema(field.element),
    };
  }

  if (field instanceof z.ZodObject) {
    return { ...result, ...zodToJsonSchemaLight(field) };
  }

  if (field instanceof z.ZodRecord) {
    return { ...result, type: 'object' };
  }

  return { ...result, type: 'string' };
}
