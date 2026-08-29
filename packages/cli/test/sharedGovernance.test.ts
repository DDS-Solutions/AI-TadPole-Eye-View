import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { createConfiguredProviderRegistry } from '@gev/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runResume } from '../src/commands/resume.js';
import { PROJECT_PHASE, runStatus } from '../src/commands/status.js';

const tempDirectories: string[] = [];

function makeTempDatabase(): { directory: string; dbPath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-cli-governance-'));
  tempDirectories.push(directory);
  return { directory, dbPath: path.join(directory, 'governance.sqlite') };
}

function captureSingleJsonLog(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((message) => {
    logs.push(message);
  });
  return { logs, restore: () => spy.mockRestore() };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('CLI connected and local governance state', () => {
  it('reports connected server state as authoritative', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          version: '1.1.0',
          seed_mode: true,
          timestamp: 1_700_000_000_000,
          stasis_active: true,
          budget_spent_usd: 4,
          budget_cap_usd: 4,
          budget_remaining_usd: 0,
          governance_authority: {
            kind: 'shared_sqlite',
            authoritative: true,
            schema_version: 2,
            state_revision: 8,
          },
          provider_registry: createConfiguredProviderRegistry(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const captured = captureSingleJsonLog();
    await runStatus({ json: true });
    captured.restore();

    const output = JSON.parse(captured.logs[0] ?? '{}');
    expect(output).toMatchObject({
      phase: PROJECT_PHASE,
      server_online: true,
      stasis_active: true,
      governance_observation: {
        source: 'server',
        authoritative: true,
        runtime: { state_revision: 8 },
      },
    });
  });

  it('labels an offline durable read as a non-authoritative snapshot', async () => {
    const { dbPath } = makeTempDatabase();
    const runtime = createGovernanceRuntimeContext({ dbPath, capUsd: 2 });
    runtime.budgetGovernor.recordSpend(2);
    runtime.close();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('server offline'));
    const captured = captureSingleJsonLog();
    await runStatus({ json: true, governanceDbPath: dbPath });
    captured.restore();

    const output = JSON.parse(captured.logs[0] ?? '{}');
    expect(output).toMatchObject({
      server_online: false,
      stasis_active: true,
      spent_usd: 2,
      governance_observation: {
        source: 'offline_snapshot',
        authoritative: false,
        runtime: { kind: 'shared_sqlite', authoritative: true },
      },
    });
  });

  it('resumes the durable offline state with an intent/outcome pair', async () => {
    const { dbPath } = makeTempDatabase();
    const runtime = createGovernanceRuntimeContext({ dbPath, capUsd: 1 });
    runtime.budgetGovernor.recordSpend(1);
    runtime.close();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('server offline'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runResume('operator recovery', { governanceDbPath: dbPath });

    const reopened = createGovernanceRuntimeContext({ dbPath });
    expect(reopened.budgetGovernor.state()).toMatchObject({
      stasis_active: false,
      last_trip: { resumed_by: 'human' },
    });
    const events = reopened.auditSink.tailByTaskRef('human-resume-override');
    expect(events.map((event) => event.kind)).toEqual(['audit.intent', 'audit.outcome']);
    reopened.close();
  });

  it('does not bypass a running server that refuses resume', async () => {
    const { dbPath } = makeTempDatabase();
    const runtime = createGovernanceRuntimeContext({ dbPath, capUsd: 1 });
    runtime.budgetGovernor.recordSpend(1);
    runtime.close();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'HUMAN_AUTH_REQUIRED' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(
      runResume('unauthenticated attempt', { governanceDbPath: dbPath })
    ).rejects.toThrow(/Server refused STASIS resume/);
    const observer = createGovernanceRuntimeContext({ dbPath });
    expect(observer.budgetGovernor.state().stasis_active).toBe(true);
    observer.close();
  });

  it('does not treat a remote transport failure as permission for local resume', async () => {
    const { dbPath } = makeTempDatabase();
    const runtime = createGovernanceRuntimeContext({ dbPath, capUsd: 1 });
    runtime.budgetGovernor.recordSpend(1);
    runtime.close();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('TLS verification failed'));

    await expect(
      runResume('remote failure attempt', {
        serverUrl: 'https://governance.example.test',
        governanceDbPath: dbPath,
      })
    ).rejects.toThrow(/refusing local resume/);
    const observer = createGovernanceRuntimeContext({ dbPath });
    expect(observer.budgetGovernor.state().stasis_active).toBe(true);
    observer.close();
  });
});
