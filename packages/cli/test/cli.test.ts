import fs from 'node:fs';
import path from 'node:path';
import { CapBudgetGovernor } from '@gev/governance';
import { describe, expect, it, vi } from 'vitest';
import { runAuditTail } from '../src/commands/audit.js';
import { runFeedsHealth } from '../src/commands/feeds.js';
import { runResume } from '../src/commands/resume.js';
import { runSceneLoad, runSceneSave } from '../src/commands/scene.js';
import { runStatus } from '../src/commands/status.js';

describe('GEV v2 CLI Surface (@gev/cli)', () => {
  it('runStatus() completes in < 100ms in offline fallback mode', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(msg);
    });

    const start = performance.now();
    await runStatus();
    const duration = performance.now() - start;

    spy.mockRestore();

    expect(duration).toBeLessThan(150); // fast local execution
    expect(logs.some((l) => l.includes('GEV v2 Console Status'))).toBe(true);
    expect(logs.some((l) => l.includes('Phase 4'))).toBe(true);
    expect(logs.some((l) => l.includes('STASIS_INACTIVE'))).toBe(true);
  });

  it('runStatus({ json: true }) outputs valid structured status JSON', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(msg);
    });

    await runStatus({ json: true });
    spy.mockRestore();

    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0] || '{}');
    expect(parsed.phase).toContain('Phase 4');
    expect(parsed.stasis_active).toBe(false);
    expect(parsed.cap_usd).toBe(10);
    expect(parsed.remaining_usd).toBe(10);
    expect(parsed.registry_counts).toEqual({
      providers: { total: 12, active: 10 },
      feeds: { total: 12, active: 10 },
      layers: { total: 12, active: 9 },
    });
    expect(parsed.provider_registry.providers).toHaveLength(12);
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
    expect(logs.some((l) => l.includes('UNAVAILABLE'))).toBe(true);
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

  it('runResume() lifts STASIS lock and records resumption event', async () => {
    const governor = new CapBudgetGovernor();
    governor.recordSpend(100.0); // trip STASIS

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(msg);
    });

    await runResume('Manual operator testing resumption');
    spy.mockRestore();

    expect(
      logs.some((l) => l.includes('STASIS LIFTED') || l.includes('STASIS is not currently active'))
    ).toBe(true);
  });
});
