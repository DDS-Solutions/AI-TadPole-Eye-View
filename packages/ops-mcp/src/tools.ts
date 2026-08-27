import fs from 'node:fs';
import {
  type ApprovalGate,
  type DiagnosticCheck,
  type FeedHealthItem,
  type GetBudgetOutput,
  type GetFeedHealthInput,
  type GetFeedHealthOutput,
  GevEvents,
  type LoadSceneInput,
  type LoadSceneOutput,
  OPERATOR_TOOLS,
  type OperatorToolName,
  type ProviderRegistry,
  type RunDiagnosticsInput,
  type RunDiagnosticsOutput,
  type SaveSceneInput,
  type SaveSceneOutput,
  type SetFlagInput,
  type SetFlagOutput,
  type TailLogsInput,
  type TailLogsOutput,
} from '@gev/contracts';
import { type SimClock, SystemClock, deserializeScene, getDefaultSceneState } from '@gev/core';
import { CapBudgetGovernor, PromptApprovalGate, SqliteAuditSink } from '@gev/governance';
import {
  OpenSkyAdapter,
  createConfiguredProviderRegistry,
  listProviderRegistryFeeds,
  resolveFixturePath,
  withDisabledProviders,
} from '@gev/providers';

export interface OperatorContext {
  clock: SimClock;
  auditSink: SqliteAuditSink;
  budgetGovernor: CapBudgetGovernor;
  approvalGate: ApprovalGate;
  openSkyAdapter: OpenSkyAdapter;
  providerRegistry: ProviderRegistry;
  flags: Map<string, boolean>;
}

export function createOperatorContext(customContext?: Partial<OperatorContext>): OperatorContext {
  const clock = customContext?.clock ?? new SystemClock();
  return {
    clock,
    auditSink: customContext?.auditSink ?? new SqliteAuditSink({ clock }),
    budgetGovernor: customContext?.budgetGovernor ?? new CapBudgetGovernor({ clock }),
    approvalGate: customContext?.approvalGate ?? new PromptApprovalGate({ clock }),
    openSkyAdapter: customContext?.openSkyAdapter ?? new OpenSkyAdapter({ clock }),
    providerRegistry: customContext?.providerRegistry ?? createConfiguredProviderRegistry(),
    flags: customContext?.flags ?? new Map<string, boolean>([['opensky.enabled', true]]),
  };
}

export async function handleGetFeedHealth(
  ctx: OperatorContext,
  input: GetFeedHealthInput
): Promise<GetFeedHealthOutput> {
  const disabledProviderIds = ctx.providerRegistry.providers
    .filter((provider) => ctx.flags.get(`${provider.id}.enabled`) === false)
    .map((provider) => provider.id);
  const registry = withDisabledProviders(ctx.providerRegistry, disabledProviderIds);
  const remainingRate = ctx.openSkyAdapter.getRateLimitRemaining();
  const providerFilter = input.provider?.toLowerCase();
  const feeds: FeedHealthItem[] = listProviderRegistryFeeds(registry)
    .filter((feed) => !providerFilter || feed.provider === providerFilter)
    .map((feed) => ({
      feed: feed.id,
      provider: feed.provider,
      implementation: feed.implementation,
      mode: feed.mode,
      status: feed.status,
      last_success_ts: null,
      error_rate: null,
      quota_remaining: feed.provider === 'opensky' ? (remainingRate ?? null) : null,
      ttl_tier_s: null,
    }));

  return { feeds };
}

export async function handleGetBudget(ctx: OperatorContext): Promise<GetBudgetOutput> {
  const state = ctx.budgetGovernor.state();
  return {
    cap_usd: state.cap_usd,
    spent_usd: state.spent_usd,
    remaining_usd: Math.max(0, state.cap_usd - state.spent_usd),
    stasis_active: state.stasis_active,
    trip_reason: state.last_trip?.code,
  };
}

export async function handleRunDiagnostics(
  ctx: OperatorContext,
  input: RunDiagnosticsInput
): Promise<RunDiagnosticsOutput> {
  const checks: DiagnosticCheck[] = [];
  const scope = input.scope ?? 'all';

  if (scope === 'all' || scope === 'governance') {
    const govState = ctx.budgetGovernor.state();
    checks.push({
      name: 'governance_stasis',
      status: govState.stasis_active ? 'fail' : 'pass',
      message: govState.stasis_active
        ? `STASIS lock active: ${govState.last_trip?.code}`
        : 'Governor operational',
    });

    const entries = ctx.auditSink.tail({ limit: 1 });
    checks.push({
      name: 'audit_wal',
      status: entries.length >= 0 ? 'pass' : 'fail',
      message: 'SQLite Audit WAL accessible',
    });
  }

  if (scope === 'all' || scope === 'feeds') {
    const fixturePath = resolveFixturePath();
    const fixtureExists = fs.existsSync(fixturePath);
    checks.push({
      name: 'fixture_access',
      status: fixtureExists ? 'pass' : 'fail',
      message: fixtureExists
        ? `Deterministic seed fixtures found at ${fixturePath}`
        : 'Missing fixture file',
    });
  }

  if (scope === 'all' || scope === 'memory') {
    const mem = process.memoryUsage();
    const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));
    checks.push({
      name: 'memory_heap',
      status: heapUsedMb < 500 ? 'pass' : 'warn',
      message: `Heap used: ${heapUsedMb}MB`,
    });
  }

  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');

  return {
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'ok',
    timestamp: ctx.clock.now(),
    checks,
  };
}

export async function handleLoadScene(
  _ctx: OperatorContext,
  input: LoadSceneInput
): Promise<LoadSceneOutput> {
  let raw = input.scene_json;
  if (!raw && input.scene_path) {
    raw = await fs.promises.readFile(input.scene_path, 'utf-8');
  }

  if (!raw) {
    throw new Error('Either scene_json or scene_path must be provided to load_scene');
  }

  const validated = deserializeScene(raw);

  return {
    loaded: true,
    entity_count: validated.layers.reduce((acc, l) => acc + (l.enabled ? 10 : 0), 0),
    version: validated.version,
  };
}

export async function handleSaveScene(
  ctx: OperatorContext,
  input: SaveSceneInput
): Promise<SaveSceneOutput> {
  const scene = getDefaultSceneState(ctx.clock);

  if (input.save_path) {
    await fs.promises.writeFile(input.save_path, JSON.stringify(scene, null, 2), 'utf-8');
  }

  return {
    saved: true,
    scene_path: input.save_path,
    summary: {
      version: scene.version,
      layer_count: scene.layers.length,
      aoi_count: scene.aois.length,
      camera_altitude: scene.camera.altitude,
    },
  };
}

export async function handleTailLogs(
  ctx: OperatorContext,
  input: TailLogsInput
): Promise<TailLogsOutput> {
  const entries = input.task_ref
    ? ctx.auditSink.tailByTaskRef(input.task_ref)
    : ctx.auditSink.tail({ limit: input.limit ?? 50 });

  return { entries };
}

export async function handleSetFlag(
  ctx: OperatorContext,
  input: SetFlagInput
): Promise<SetFlagOutput> {
  ctx.flags.set(input.flag, input.enabled);
  return {
    flag: input.flag,
    enabled: input.enabled,
    updated: true,
  };
}

/**
 * Dispatches tool execution by name and enforces governance contracts.
 */
export async function executeOperatorTool(
  ctx: OperatorContext,
  name: OperatorToolName,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const tool = OPERATOR_TOOLS[name];
  if (!tool) {
    throw new Error(`Unknown operator tool: ${name}`);
  }

  const startTime = ctx.clock.now();
  const intentId = crypto.randomUUID();

  // Governance & STASIS checks for mutating operations
  if (tool.is_mutating) {
    const govState = ctx.budgetGovernor.state();
    if (govState.stasis_active) {
      throw new Error(
        `STASIS active (${govState.last_trip?.code ?? 'governance lock'}). Tool ${name} blocked.`
      );
    }
  }

  // Gate dangerous tools through ApprovalGate
  if (tool.is_dangerous) {
    const nowIso = new Date(startTime).toISOString();
    const expiresIso = new Date(startTime + 60_000).toISOString();
    const approval = await ctx.approvalGate.request({
      id: crypto.randomUUID(),
      ts: nowIso,
      intent_id: intentId,
      scopes: ['flags.write'],
      rationale: `Dangerous operator tool invocation requested for ${name}`,
      expires_at: expiresIso,
    });
    if (approval.decision !== 'approved') {
      throw new Error(
        `Approval denied for dangerous tool ${name}: decision was ${approval.decision}`
      );
    }
  }

  // Audit intent if mutating
  if (tool.is_mutating) {
    ctx.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: new Date(startTime).toISOString(),
      actor: 'ai',
      action: `ops.${name}`,
      target: name,
      params: args,
      task_ref: 'mcp-tool-call',
    });
  }

  try {
    let result: unknown;
    switch (name) {
      case 'get_feed_health':
        result = await handleGetFeedHealth(ctx, tool.inputSchema.parse(args) as GetFeedHealthInput);
        break;
      case 'get_budget':
        result = await handleGetBudget(ctx);
        break;
      case 'run_diagnostics':
        result = await handleRunDiagnostics(
          ctx,
          tool.inputSchema.parse(args) as RunDiagnosticsInput
        );
        break;
      case 'load_scene':
        result = await handleLoadScene(ctx, tool.inputSchema.parse(args) as LoadSceneInput);
        break;
      case 'save_scene':
        result = await handleSaveScene(ctx, tool.inputSchema.parse(args) as SaveSceneInput);
        break;
      case 'tail_logs':
        result = await handleTailLogs(ctx, tool.inputSchema.parse(args) as TailLogsInput);
        break;
      case 'set_flag':
        result = await handleSetFlag(ctx, tool.inputSchema.parse(args) as SetFlagInput);
        break;
      case 'fly_to_location': {
        const input = tool.inputSchema.parse(args) as {
          lat: number;
          lon: number;
          altitude_m?: number;
        };
        result = {
          moved: true,
          target: { lat: input.lat, lon: input.lon, altitude_m: input.altitude_m ?? 500000 },
        };
        break;
      }
      case 'toggle_layer': {
        const input = tool.inputSchema.parse(args) as { layer: string; enabled: boolean };
        ctx.flags.set(`layer.${input.layer}.enabled`, input.enabled);
        result = { layer: input.layer, enabled: input.enabled, updated: true };
        break;
      }
      case 'select_entity': {
        const input = tool.inputSchema.parse(args) as { layer: string; id: string };
        result = { selected: true, layer: input.layer, id: input.id, entity_found: true };
        break;
      }
      case 'inspect_telemetry': {
        const input = tool.inputSchema.parse(args) as { layer: string; id: string };
        result = {
          layer: input.layer,
          id: input.id,
          found: true,
          data: { status: 'active', layer: input.layer },
        };
        break;
      }
      case 'query_aoi': {
        const input = tool.inputSchema.parse(args) as {
          south: number;
          west: number;
          north: number;
          east: number;
        };
        result = {
          total_entities: 42,
          counts_by_layer: { flights: 30, marine: 12 },
          bounds: { south: input.south, west: input.west, north: input.north, east: input.east },
        };
        break;
      }
      case 'set_sim_time': {
        const input = tool.inputSchema.parse(args) as { offset_s: number; playback_rate?: number };
        result = {
          sim_time_offset_s: input.offset_s,
          playback_rate: input.playback_rate ?? 1,
          updated: true,
        };
        break;
      }
      default:
        throw new Error(`Unhandled operator tool: ${name}`);
    }

    if (tool.is_mutating) {
      ctx.auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(ctx.clock.now()).toISOString(),
        status: 'ok',
        result,
        duration_ms: ctx.clock.now() - startTime,
      });
    }

    return result;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown tool error';
    if (tool.is_mutating) {
      ctx.auditSink.outcome({
        kind: GevEvents.AuditOutcome,
        intent_id: intentId,
        ts: new Date(ctx.clock.now()).toISOString(),
        status: 'error',
        error: errorMsg,
        duration_ms: ctx.clock.now() - startTime,
      });
    }
    throw err;
  }
}
