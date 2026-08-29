import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GevEvents,
  LoadSceneOutputSchema,
  SaveSceneOutputSchema,
  SceneState,
} from '@gev/contracts';
import { FrozenClock, getDefaultSceneState } from '@gev/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SCENE_BYTES,
  type OperatorContext,
  createOperatorContext,
  executeOperatorTool as executeOperatorToolResult,
  handleRunDiagnostics,
} from '../src/index.js';

const temporaryPaths: string[] = [];
const contexts: OperatorContext[] = [];
let fetchSpy: ReturnType<typeof vi.fn>;

async function makeSceneRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gev-mcp-scenes-'));
  temporaryPaths.push(root);
  return root;
}

function makeContext(sceneRoot: string): OperatorContext {
  const context = createOperatorContext({
    clock: new FrozenClock(1_700_000_000_000),
    sceneRoot,
  });
  contexts.push(context);
  return context;
}

function makeScene() {
  const clock = new FrozenClock(1_700_000_000_000);
  return SceneState.parse({
    ...getDefaultSceneState(clock),
    layers: [
      { id: 'flights', enabled: true, opacity: 1 },
      { id: 'marine', enabled: false, opacity: 0.5 },
      { id: 'quakes', enabled: true, opacity: 0.8 },
    ],
    selected_entity: { kind: 'aircraft', id: 'verified-aircraft' },
  });
}

async function executeOperatorTool(
  context: OperatorContext,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const execution = await executeOperatorToolResult(context, name, args);
  if (!execution.success) {
    throw new Error(execution.error ?? `Tool ${name} failed`);
  }
  return execution.result;
}

beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error('Live network access is forbidden in MCP scene tests');
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  while (contexts.length > 0) {
    try {
      contexts.pop()?.governanceContext.close();
    } catch {
      // A diagnostics test intentionally closes its sink first.
    }
  }
  while (temporaryPaths.length > 0) {
    const temporaryPath = temporaryPaths.pop();
    if (temporaryPath) {
      await fs.promises.rm(temporaryPath, { recursive: true, force: true });
    }
  }
});

describe('local MCP scene confinement and truth', () => {
  it('loads real local state, saves it atomically, and audits intent before outcome', async () => {
    const sceneRoot = await makeSceneRoot();
    const context = makeContext(sceneRoot);
    const scene = makeScene();

    const loaded = LoadSceneOutputSchema.parse(
      await executeOperatorTool(context, 'load_scene', {
        scene_json: JSON.stringify(scene),
      })
    );
    expect(loaded).toMatchObject({
      loaded: true,
      source: 'inline',
      summary: {
        version: 1,
        layer_count: 3,
        enabled_layer_count: 2,
        aoi_count: 0,
        selected_entity: { kind: 'aircraft', id: 'verified-aircraft' },
      },
    });
    expect(loaded).not.toHaveProperty('entity_count');

    const saved = SaveSceneOutputSchema.parse(
      await executeOperatorTool(context, 'save_scene', { save_path: 'snapshot.json' })
    );
    expect(saved.scene_path).toBe('snapshot.json');
    expect(saved.summary).toEqual(loaded.summary);

    const persisted = SceneState.parse(
      JSON.parse(await fs.promises.readFile(path.join(sceneRoot, 'snapshot.json'), 'utf-8'))
    );
    expect(persisted).toEqual(scene);
    expect((await fs.promises.readdir(sceneRoot)).filter((name) => name.endsWith('.tmp'))).toEqual(
      []
    );

    const entries = context.auditSink.tail({ limit: 10 });
    expect(entries.map((entry) => entry.kind)).toEqual([
      GevEvents.AuditIntent,
      GevEvents.AuditOutcome,
      GevEvents.AuditIntent,
      GevEvents.AuditOutcome,
    ]);
    expect(entries[0]).toMatchObject({ action: 'tool.load_scene' });
    expect(entries[2]).toMatchObject({ action: 'tool.save_scene' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('loads only a regular root-level JSON file beneath the configured root', async () => {
    const sceneRoot = await makeSceneRoot();
    const context = makeContext(sceneRoot);
    await fs.promises.writeFile(
      path.join(sceneRoot, 'verified.json'),
      JSON.stringify(makeScene()),
      'utf-8'
    );

    const loaded = LoadSceneOutputSchema.parse(
      await executeOperatorTool(context, 'load_scene', { scene_path: 'verified.json' })
    );
    expect(loaded.source).toBe('file');
    expect(loaded.scene_path).toBe('verified.json');
    expect(context.sceneState.layers).toHaveLength(3);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('atomically replaces an existing scene file inside the configured root', async () => {
    const sceneRoot = await makeSceneRoot();
    const context = makeContext(sceneRoot);
    context.sceneState = makeScene();
    await executeOperatorTool(context, 'save_scene', { save_path: 'replace.json' });

    context.sceneState = SceneState.parse({
      ...context.sceneState,
      camera: { ...context.sceneState.camera, altitude: 123_456 },
    });
    await executeOperatorTool(context, 'save_scene', { save_path: 'replace.json' });

    const persisted = SceneState.parse(
      JSON.parse(await fs.promises.readFile(path.join(sceneRoot, 'replace.json'), 'utf-8'))
    );
    expect(persisted.camera.altitude).toBe(123_456);
    expect((await fs.promises.readdir(sceneRoot)).filter((name) => name.endsWith('.tmp'))).toEqual(
      []
    );
  });

  it.each([
    '../outside.json',
    '..\\outside.json',
    'nested/scene.json',
    'nested\\scene.json',
    'C:\\outside.json',
    '\\\\server\\share\\scene.json',
    'scene.json:stream',
    'scene.txt',
  ])('rejects cross-platform escape or unsupported path %s', async (scenePath) => {
    const sceneRoot = await makeSceneRoot();
    const context = makeContext(sceneRoot);

    await expect(
      executeOperatorTool(context, 'save_scene', { save_path: scenePath })
    ).rejects.toThrow(/Scene path/);
    const loadContext = makeContext(sceneRoot);
    await expect(
      executeOperatorTool(loadContext, 'load_scene', { scene_path: scenePath })
    ).rejects.toThrow(/Scene path/);
    expect(await fs.promises.readdir(sceneRoot)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an absolute path even when it points beneath the configured root', async () => {
    const sceneRoot = await makeSceneRoot();
    const context = makeContext(sceneRoot);
    const absolutePath = path.join(sceneRoot, 'absolute.json');

    await expect(
      executeOperatorTool(context, 'save_scene', { save_path: absolutePath })
    ).rejects.toThrow('relative to the configured scene root');
    expect(await fs.promises.readdir(sceneRoot)).toEqual([]);
  });

  it('rejects a scene symlink instead of following it outside the root when supported', async () => {
    const sceneRoot = await makeSceneRoot();
    const context = makeContext(sceneRoot);
    const outsidePath = `${sceneRoot}-outside.json`;
    temporaryPaths.push(outsidePath);
    await fs.promises.writeFile(outsidePath, JSON.stringify(makeScene()), 'utf-8');

    try {
      await fs.promises.symlink(outsidePath, path.join(sceneRoot, 'escape.json'), 'file');
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        ['EPERM', 'EACCES'].includes(String(error.code))
      ) {
        return;
      }
      throw error;
    }

    await expect(
      executeOperatorTool(context, 'load_scene', { scene_path: 'escape.json' })
    ).rejects.toThrow('symbolic links are not allowed');
    const saveContext = makeContext(sceneRoot);
    await expect(
      executeOperatorTool(saveContext, 'save_scene', { save_path: 'escape.json' })
    ).rejects.toThrow('symbolic links are not allowed');
    expect(await fs.promises.readFile(outsidePath, 'utf-8')).toBe(JSON.stringify(makeScene()));
  });

  it('rejects oversized files and byte-heavy inline payloads before parsing', async () => {
    const sceneRoot = await makeSceneRoot();
    const context = makeContext(sceneRoot);
    await fs.promises.writeFile(
      path.join(sceneRoot, 'oversized.json'),
      Buffer.alloc(MAX_SCENE_BYTES + 1, 0x20)
    );

    await expect(
      executeOperatorTool(context, 'load_scene', { scene_path: 'oversized.json' })
    ).rejects.toThrow(`${MAX_SCENE_BYTES} byte limit`);
    const inlineContext = makeContext(sceneRoot);
    await expect(
      executeOperatorTool(inlineContext, 'load_scene', {
        scene_json: JSON.stringify('é'.repeat(MAX_SCENE_BYTES / 2)),
      })
    ).rejects.toThrow(`${MAX_SCENE_BYTES} byte limit`);
  });

  it('removes the temporary file when the final atomic rename fails', async () => {
    const sceneRoot = await makeSceneRoot();
    const context = makeContext(sceneRoot);
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('simulated rename failure'));

    await expect(
      executeOperatorTool(context, 'save_scene', { save_path: 'failed.json' })
    ).rejects.toThrow('simulated rename failure');
    expect(await fs.promises.readdir(sceneRoot)).toEqual([]);

    const entries = context.auditSink.tail({ limit: 10 });
    expect(entries.map((entry) => entry.kind)).toEqual([
      GevEvents.AuditIntent,
      GevEvents.AuditOutcome,
    ]);
    expect(entries[1]).toMatchObject({ status: 'error' });
  });

  it('marks the audit diagnostic failed when the verified query operation fails', async () => {
    const sceneRoot = await makeSceneRoot();
    const context = makeContext(sceneRoot);
    vi.spyOn(context.auditSink, 'tail').mockImplementation(() => {
      throw new Error('simulated audit query failure');
    });

    const diagnostics = await handleRunDiagnostics(context, { scope: 'governance' });
    expect(diagnostics.status).toBe('fail');
    expect(diagnostics.checks.find((check) => check.name === 'audit_wal')).toMatchObject({
      status: 'fail',
      message: 'SQLite audit query failed',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
