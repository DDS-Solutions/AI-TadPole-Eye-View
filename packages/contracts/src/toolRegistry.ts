import { z } from 'zod';
import { CostEstimate } from './ports.js';
import {
  FlyToLocationInputSchema,
  FlyToLocationOutputSchema,
  GetBudgetInputSchema,
  GetBudgetOutputSchema,
  GetFeedHealthInputSchema,
  GetFeedHealthOutputSchema,
  InspectTelemetryInputSchema,
  InspectTelemetryOutputSchema,
  LoadSceneInputSchema,
  LoadSceneOutputSchema,
  QueryAoiInputSchema,
  QueryAoiOutputSchema,
  RunDiagnosticsInputSchema,
  RunDiagnosticsOutputSchema,
  SaveSceneInputSchema,
  SaveSceneOutputSchema,
  SelectEntityInputSchema,
  SelectEntityOutputSchema,
  SetFlagInputSchema,
  SetFlagOutputSchema,
  SetSimTimeInputSchema,
  SetSimTimeOutputSchema,
  TailLogsInputSchema,
  TailLogsOutputSchema,
  ToggleLayerInputSchema,
  ToggleLayerOutputSchema,
} from './toolSchemas.js';

export const ToolMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  is_mutating: z.boolean(),
  is_dangerous: z.boolean(),
  is_cacheable: z.boolean(),
  requires_reservation: z.boolean(),
  cost_estimate: CostEstimate,
  timeout_ms: z.number().int().min(1_000).max(60_000),
});
export type ToolMetadata = z.infer<typeof ToolMetadataSchema>;

export type OperatorToolDefinition<
  TName extends string,
  TIn extends z.ZodTypeAny,
  TOut extends z.ZodTypeAny,
> = ToolMetadata & {
  name: TName;
  inputSchema: TIn;
  outputSchema: TOut;
};

const NONBILLABLE_READ_POLICY = {
  requires_reservation: false,
  cost_estimate: { currency: 'usd', min: 0, max: 0 },
  timeout_ms: 30_000,
} as const;

const MUTATION_RESERVATION_POLICY = {
  requires_reservation: true,
  cost_estimate: { currency: 'usd', min: 0, max: 0 },
  timeout_ms: 30_000,
} as const;

/** Shared source of truth for every operator-tool consumer and transport projection. */
export const OPERATOR_TOOLS = {
  get_feed_health: {
    ...NONBILLABLE_READ_POLICY,
    name: 'get_feed_health',
    description: 'Query provider registry health and observed quota data where available',
    is_mutating: false,
    is_dangerous: false,
    is_cacheable: true,
    inputSchema: GetFeedHealthInputSchema,
    outputSchema: GetFeedHealthOutputSchema,
  },
  get_budget: {
    ...NONBILLABLE_READ_POLICY,
    name: 'get_budget',
    description: 'Check cost governor budget consumption, limits, and STASIS lock state',
    is_mutating: false,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: GetBudgetInputSchema,
    outputSchema: GetBudgetOutputSchema,
  },
  run_diagnostics: {
    ...NONBILLABLE_READ_POLICY,
    name: 'run_diagnostics',
    description: 'Execute verified local fixture, memory, audit, and governance self-checks',
    is_mutating: false,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: RunDiagnosticsInputSchema,
    outputSchema: RunDiagnosticsOutputSchema,
  },
  load_scene: {
    ...MUTATION_RESERVATION_POLICY,
    name: 'load_scene',
    description: 'Load a serialized globe scene state (destructive state overwrite)',
    is_mutating: true,
    is_dangerous: true,
    is_cacheable: false,
    inputSchema: LoadSceneInputSchema,
    outputSchema: LoadSceneOutputSchema,
  },
  save_scene: {
    ...MUTATION_RESERVATION_POLICY,
    name: 'save_scene',
    description: 'Snapshot current globe state into a reproducible scene file',
    is_mutating: true,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: SaveSceneInputSchema,
    outputSchema: SaveSceneOutputSchema,
  },
  tail_logs: {
    ...NONBILLABLE_READ_POLICY,
    name: 'tail_logs',
    description: 'Query recent audit log intent/outcome entries from SQLite WAL',
    is_mutating: false,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: TailLogsInputSchema,
    outputSchema: TailLogsOutputSchema,
  },
  set_flag: {
    ...MUTATION_RESERVATION_POLICY,
    name: 'set_flag',
    description: 'Toggle feature kill-switch flags dynamically',
    is_mutating: true,
    is_dangerous: true,
    is_cacheable: false,
    inputSchema: SetFlagInputSchema,
    outputSchema: SetFlagOutputSchema,
  },
  fly_to_location: {
    ...MUTATION_RESERVATION_POLICY,
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
    ...MUTATION_RESERVATION_POLICY,
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
    ...MUTATION_RESERVATION_POLICY,
    name: 'select_entity',
    description: 'Select and track a specific telemetry entity on the 3D globe by ID and layer',
    is_mutating: true,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: SelectEntityInputSchema,
    outputSchema: SelectEntityOutputSchema,
  },
  inspect_telemetry: {
    ...NONBILLABLE_READ_POLICY,
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
    ...NONBILLABLE_READ_POLICY,
    name: 'query_aoi',
    description: 'Query entity density and counts within an Area of Interest (AOI) bounding box',
    is_mutating: false,
    is_dangerous: false,
    is_cacheable: true,
    inputSchema: QueryAoiInputSchema,
    outputSchema: QueryAoiOutputSchema,
  },
  set_sim_time: {
    ...MUTATION_RESERVATION_POLICY,
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

const OPERATOR_TOOL_NAME_SET: ReadonlySet<string> = new Set(Object.keys(OPERATOR_TOOLS));

export function isOperatorToolName(name: string): name is OperatorToolName {
  return OPERATOR_TOOL_NAME_SET.has(name);
}
