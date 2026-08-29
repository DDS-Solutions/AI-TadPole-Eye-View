import fs from 'node:fs';
import path from 'node:path';
import type {
  DiagnosticCheck,
  FeedHealthItem,
  GetBudgetOutput,
  GetFeedHealthInput,
  GetFeedHealthOutput,
  LoadSceneInput,
  LoadSceneOutput,
  OperatorToolName,
  RunDiagnosticsInput,
  RunDiagnosticsOutput,
  SaveSceneInput,
  SaveSceneOutput,
  SceneState,
  SceneToolSummary,
  SetFlagInput,
  SetFlagOutput,
  TailLogsInput,
  TailLogsOutput,
} from '@gev/contracts';
import { type ToolExecutionContext, type ToolExecutionResult, deserializeScene } from '@gev/core';
import {
  listProviderRegistryFeeds,
  resolveFixturePath,
  withDisabledProviders,
} from '@gev/providers';
import type { OperatorContext } from './context.js';

export const MAX_SCENE_BYTES = 1024 * 1024;
export const MCP_OPERATOR_TOOL_NAMES = [
  'get_feed_health',
  'get_budget',
  'run_diagnostics',
  'load_scene',
  'save_scene',
  'tail_logs',
  'set_flag',
] as const satisfies readonly OperatorToolName[];
export type McpOperatorToolName = (typeof MCP_OPERATOR_TOOL_NAMES)[number];
const MCP_OPERATOR_TOOL_NAME_SET: ReadonlySet<string> = new Set(MCP_OPERATOR_TOOL_NAMES);
export function isMcpOperatorToolName(name: string): name is McpOperatorToolName {
  return MCP_OPERATOR_TOOL_NAME_SET.has(name);
}
function validateSceneFileName(scenePath: string): string {
  const candidate = scenePath.trim();
  if (!candidate || candidate !== scenePath || candidate.includes('\0')) {
    throw new Error('Scene path must be a non-empty filename without surrounding whitespace');
  }
  if (
    path.isAbsolute(candidate) ||
    path.win32.isAbsolute(candidate) ||
    path.posix.isAbsolute(candidate) ||
    /^[A-Za-z]:/.test(candidate)
  ) {
    throw new Error('Scene path must be relative to the configured scene root');
  }
  if (candidate.includes('/') || candidate.includes('\\') || candidate.includes(':')) {
    throw new Error('Scene path must be a root-level filename; directories are not allowed');
  }
  if (
    candidate === '.' ||
    candidate === '..' ||
    path.extname(candidate).toLowerCase() !== '.json'
  ) {
    throw new Error('Scene path must use a .json filename');
  }
  return candidate;
}
function assertWithinSceneRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Scene path escapes the configured scene root');
  }
}
async function canonicalSceneRoot(sceneRoot: string, create: boolean): Promise<string> {
  if (create) {
    await fs.promises.mkdir(sceneRoot, { recursive: true });
  }
  const canonicalRoot = await fs.promises.realpath(sceneRoot);
  const rootStat = await fs.promises.stat(canonicalRoot);
  if (!rootStat.isDirectory()) {
    throw new Error('Configured scene root is not a directory');
  }
  return canonicalRoot;
}
async function readSceneFile(
  sceneRoot: string,
  requestedPath: string
): Promise<{
  raw: string;
  scenePath: string;
}> {
  const scenePath = validateSceneFileName(requestedPath);
  const root = await canonicalSceneRoot(sceneRoot, false);
  const candidate = path.join(root, scenePath);
  assertWithinSceneRoot(root, candidate);
  const linkStat = await fs.promises.lstat(candidate);
  if (linkStat.isSymbolicLink()) {
    throw new Error('Scene path symbolic links are not allowed');
  }
  if (!linkStat.isFile()) {
    throw new Error('Scene path must reference a regular file');
  }
  const canonicalFile = await fs.promises.realpath(candidate);
  assertWithinSceneRoot(root, canonicalFile);
  const handle = await fs.promises.open(canonicalFile, 'r');
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size > MAX_SCENE_BYTES) {
      throw new Error(`Scene file exceeds the ${MAX_SCENE_BYTES} byte limit`);
    }
    const raw = await handle.readFile({ encoding: 'utf-8' });
    if (Buffer.byteLength(raw, 'utf-8') > MAX_SCENE_BYTES) {
      throw new Error(`Scene file exceeds the ${MAX_SCENE_BYTES} byte limit`);
    }
    return { raw, scenePath };
  } finally {
    await handle.close();
  }
}
async function writeSceneFile(
  sceneRoot: string,
  requestedPath: string,
  raw: string
): Promise<string> {
  const scenePath = validateSceneFileName(requestedPath);
  const root = await canonicalSceneRoot(sceneRoot, true);
  const candidate = path.join(root, scenePath);
  assertWithinSceneRoot(root, candidate);
  try {
    const existing = await fs.promises.lstat(candidate);
    if (existing.isSymbolicLink()) {
      throw new Error('Scene path symbolic links are not allowed');
    }
    if (!existing.isFile()) {
      throw new Error('Scene path must reference a regular file');
    }
    assertWithinSceneRoot(root, await fs.promises.realpath(candidate));
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
  const bytes = Buffer.byteLength(raw, 'utf-8');
  if (bytes > MAX_SCENE_BYTES) {
    throw new Error(`Serialized scene exceeds the ${MAX_SCENE_BYTES} byte limit`);
  }
  const tempPath = path.join(root, `.${scenePath}.${crypto.randomUUID()}.tmp`);
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(tempPath, 'wx', 0o600);
    await handle.writeFile(raw, { encoding: 'utf-8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.promises.rename(tempPath, candidate);
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.promises.unlink(tempPath).catch(() => undefined);
  }
  return scenePath;
}
function summarizeScene(scene: SceneState): SceneToolSummary {
  return {
    version: scene.version,
    layer_count: scene.layers.length,
    enabled_layer_count: scene.layers.filter((layer) => layer.enabled).length,
    aoi_count: scene.aois.length,
    camera_altitude: scene.camera.altitude,
    selected_entity: scene.selected_entity,
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
    governance_authority: ctx.governanceContext.authority(),
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
    try {
      const entries = ctx.auditSink.tail({ limit: 1 });
      checks.push({
        name: 'audit_wal',
        status: 'pass',
        message: `SQLite audit query succeeded (${entries.length} entries returned)`,
      });
    } catch {
      checks.push({
        name: 'audit_wal',
        status: 'fail',
        message: 'SQLite audit query failed',
      });
    }
  }
  if (scope === 'all' || scope === 'feeds') {
    const fixturePath = resolveFixturePath();
    try {
      await fs.promises.access(fixturePath, fs.constants.R_OK);
      const fixtureStat = await fs.promises.stat(fixturePath);
      checks.push({
        name: 'fixture_access',
        status: fixtureStat.isFile() ? 'pass' : 'fail',
        message: fixtureStat.isFile()
          ? 'Deterministic seed fixture is readable'
          : 'Seed fixture path is not a regular file',
      });
    } catch {
      checks.push({
        name: 'fixture_access',
        status: 'fail',
        message: 'Deterministic seed fixture is not readable',
      });
    }
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
  ctx: OperatorContext,
  input: LoadSceneInput
): Promise<LoadSceneOutput> {
  let raw: string;
  let source: 'inline' | 'file';
  let scenePath: string | undefined;
  if (input.scene_json !== undefined) {
    if (Buffer.byteLength(input.scene_json, 'utf-8') > MAX_SCENE_BYTES) {
      throw new Error(`Inline scene exceeds the ${MAX_SCENE_BYTES} byte limit`);
    }
    raw = input.scene_json;
    source = 'inline';
  } else {
    const file = await readSceneFile(ctx.sceneRoot, input.scene_path as string);
    raw = file.raw;
    scenePath = file.scenePath;
    source = 'file';
  }

  const validated = deserializeScene(raw);
  ctx.sceneState = validated;

  return {
    loaded: true,
    source,
    scene_path: scenePath,
    summary: summarizeScene(validated),
  };
}

export async function handleSaveScene(
  ctx: OperatorContext,
  input: SaveSceneInput
): Promise<SaveSceneOutput> {
  const scene = ctx.sceneState;
  const scenePath = await writeSceneFile(
    ctx.sceneRoot,
    input.save_path,
    `${JSON.stringify(scene, null, 2)}\n`
  );

  return {
    saved: true,
    scene_path: scenePath,
    summary: summarizeScene(scene),
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

/** Registers the seven local stdio implementations on the shared governed executor. */
export function registerOperatorToolHandlers(ctx: OperatorContext): void {
  ctx.toolExecutor
    .register('get_feed_health', (input) => handleGetFeedHealth(ctx, input))
    .register('get_budget', () => handleGetBudget(ctx))
    .register('run_diagnostics', (input) => handleRunDiagnostics(ctx, input))
    .register('load_scene', (input) => handleLoadScene(ctx, input))
    .register('save_scene', (input) => handleSaveScene(ctx, input))
    .register('tail_logs', (input) => handleTailLogs(ctx, input))
    .register('set_flag', (input) => handleSetFlag(ctx, input));
}

/** Executes through the one core lifecycle; this function performs no governance itself. */
export async function executeOperatorTool(
  ctx: OperatorContext,
  name: string,
  args: unknown = {},
  context: Pick<ToolExecutionContext, 'operation_id'> = {}
): Promise<ToolExecutionResult> {
  return ctx.toolExecutor.execute(name, args, {
    actor: 'ai',
    task_ref: 'mcp-tool-call',
    ...context,
  });
}
