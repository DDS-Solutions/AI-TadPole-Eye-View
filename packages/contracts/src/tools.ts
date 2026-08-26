import { z } from 'zod';
import { AuditEntrySchema } from './ports.js';
import { SceneState } from './scene.js';

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
  provider: z.string(),
  status: z.enum(['healthy', 'degraded', 'unreachable']),
  last_success_ts: z.number().finite().optional(),
  error_rate: z.number().finite().min(0).max(1),
  quota_remaining: z.number().finite().optional(),
  ttl_tier_s: z.number().finite(),
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
export const LoadSceneInputSchema = z.object({
  scene_json: z.string().optional(),
  scene_path: z.string().optional(),
});
export type LoadSceneInput = z.infer<typeof LoadSceneInputSchema>;

export const LoadSceneOutputSchema = z.object({
  loaded: z.boolean(),
  entity_count: z.number().finite().nonnegative(),
  version: z.number().finite(),
});
export type LoadSceneOutput = z.infer<typeof LoadSceneOutputSchema>;

// 5. save_scene
export const SaveSceneInputSchema = z.object({
  title: z.string().optional(),
  save_path: z.string().optional(),
});
export type SaveSceneInput = z.infer<typeof SaveSceneInputSchema>;

export const SaveSceneOutputSchema = z.object({
  saved: z.boolean(),
  scene_path: z.string().optional(),
  scene: SceneState,
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

/**
 * Registry of standard operator tool definitions with governance flags.
 */
export const OPERATOR_TOOLS = {
  get_feed_health: {
    name: 'get_feed_health',
    description: 'Query telemetry provider health status, error rates, and remaining quotas',
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
    description: 'Execute health, memory, and governance self-checks across services',
    is_mutating: false,
    is_dangerous: false,
    is_cacheable: false,
    inputSchema: RunDiagnosticsInputSchema,
    outputSchema: RunDiagnosticsOutputSchema,
  },
  load_scene: {
    name: 'load_scene',
    description: 'Load a serialized globe scene state (camera, layers, AOIs)',
    is_mutating: true,
    is_dangerous: false,
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
} as const;

export type OperatorToolName = keyof typeof OPERATOR_TOOLS;
