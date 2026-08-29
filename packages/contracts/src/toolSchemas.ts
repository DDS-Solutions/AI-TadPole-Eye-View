import { z } from 'zod';
import { GovernanceAuthoritySchema } from './governance.js';
import { AuditEntrySchema } from './ports.js';
import {
  ProviderHealthSchema,
  ProviderImplementationStateSchema,
  ProviderRegistryIdSchema,
  ProviderRuntimeModeSchema,
} from './providerRegistry.js';
import { SelectedEntity } from './scene.js';

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

export const GetBudgetInputSchema = z.object({});
export type GetBudgetInput = z.infer<typeof GetBudgetInputSchema>;

export const GetBudgetOutputSchema = z.object({
  cap_usd: z.number().finite().nonnegative(),
  spent_usd: z.number().finite().nonnegative(),
  remaining_usd: z.number().finite().nonnegative(),
  stasis_active: z.boolean(),
  trip_reason: z.string().optional(),
  governance_authority: GovernanceAuthoritySchema,
});
export type GetBudgetOutput = z.infer<typeof GetBudgetOutputSchema>;

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

export const TailLogsInputSchema = z.object({
  limit: z.number().finite().positive().max(1000).default(50).optional(),
  task_ref: z.string().optional(),
});
export type TailLogsInput = z.infer<typeof TailLogsInputSchema>;

export const TailLogsOutputSchema = z.object({
  entries: z.array(AuditEntrySchema),
});
export type TailLogsOutput = z.infer<typeof TailLogsOutputSchema>;

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
