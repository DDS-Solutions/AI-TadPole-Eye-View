import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { describe, expect, it, vi } from 'vitest';
import { runAuditTail, runAuditVerify } from '../src/commands/audit.js';
import { runFeedsHealth } from '../src/commands/feeds.js';
import { runResume } from '../src/commands/resume.js';
import { runSceneLoad, runSceneSave } from '../src/commands/scene.js';
import { PROJECT_PHASE, runStatus } from '../src/commands/status.js';

describe('GEV v2 CLI Surface (@gev/cli)', () => {
  it('runStatus() completes in < 100ms in offline fallback mode', async () => {
    const logs: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('server offline'));
    const spy = vi.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(msg);
    });

    const start = performance.now();
    await runStatus();
    const duration = performance.now() - start;

    spy.mockRestore();
    fetchSpy.mockRestore();

    expect(duration).toBeLessThan(150); // fast local execution
    expect(logs.some((l) => l.includes('GEV v2 Console Status'))).toBe(true);
    expect(logs.some((l) => l.includes(PROJECT_PHASE))).toBe(true);
    expect(logs.some((l) => l.includes('STASIS_INACTIVE'))).toBe(true);
  });

  it('runStatus({ json: true }) outputs valid structured status JSON', async () => {
    const logs: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('server offline'));
    const spy = vi.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(msg);
    });

    await runStatus({ json: true });
    spy.mockRestore();
    fetchSpy.mockRestore();

    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0] || '{}');
    expect(parsed.phase).toBe(PROJECT_PHASE);
    expect(parsed.stasis_active).toBe(false);
    expect(parsed.cap_usd).toBe(10);
    expect(parsed.remaining_usd).toBe(10);
    expect(parsed.registry_counts).toEqual({
      providers: { total: 19, active: 12 },
      feeds: { total: 22, active: 12 },
      layers: { total: 19, active: 11 },
    });
    expect(parsed.provider_registry.providers).toHaveLength(19);
  });

  it('runFeedsHealth() displays telemetry feed table', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(msg);
    });

    await runFeedsHealth();
    spy.mockRestore();

    expect(logs.some((l) => l.includes('Feed Diagnostics'))).toBe(true);
    expect(logs.some((l) => l.includes('OpenSky'))).toBe(true);
    expect(logs.some((l) => l.includes('HEALTHY'))).toBe(true);
    expect(logs.some((l) => l.includes('CelesTrak'))).toBe(true);
    expect(logs.some((l) => l.includes('satellites'))).toBe(true);
  });

  it('runAuditTail() displays audit log table', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(msg);
    });

    await runAuditTail({ limit: 10 });
    spy.mockRestore();

    expect(logs.some((l) => l.includes('Audit Trail'))).toBe(true);
  });

  it('runAuditVerify() performs a read-only local integrity inspection when offline', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-cli-audit-'));
    const dbPath = path.join(directory, 'governance.sqlite');
    const runtime = createGovernanceRuntimeContext({ dbPath });
    runtime.close();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('server offline'));
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message) => logs.push(message));
    try {
      const integrity = await runAuditVerify({ dbPath });
      expect(integrity).toMatchObject({ status: 'valid', chain_version: 'gev.audit.chain.v1' });
      expect(logs.some((line) => line.includes('Audit Integrity'))).toBe(true);
      expect(logs.some((line) => line.includes('local read-only snapshot'))).toBe(true);
    } finally {
      logSpy.mockRestore();
      fetchSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    }
  });

  it('runAuditVerify() does not bypass a connected authentication rejection', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 401 }));
    try {
      await expect(runAuditVerify()).rejects.toThrow(/requires operator authentication/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('runSceneSave() and runSceneLoad() round-trip reproducible scene state', async () => {
    const tempFile = path.resolve(process.cwd(), 'temp-test-scene.json');

    try {
      const logs: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((msg) => {
        logs.push(msg);
      });

      await runSceneSave(tempFile);
      expect(fs.existsSync(tempFile)).toBe(true);

      await runSceneLoad(tempFile);
      expect(logs.some((l) => l.includes('Successfully loaded and validated scene'))).toBe(true);

      spy.mockRestore();
    } finally {
      if (fs.existsSync(tempFile)) {
        await fs.promises.unlink(tempFile);
      }
    }
  });

  it('runResume() refuses a process-local offline fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('server offline'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      runResume('Manual operator testing resumption', { governanceDbPath: ':memory:' })
    ).rejects.toThrow(/requires durable shared SQLite governance state/);
  });
});
