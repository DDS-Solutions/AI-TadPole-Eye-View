import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { describe, expect, it, vi } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';

describe('gev doctor command', () => {
  it('verifies runtime, plan parity, fixtures, and governance SQLite chain without leaking secrets', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-doctor-'));
    const dbPath = path.join(tempDir, 'governance.sqlite');
    const runtime = createGovernanceRuntimeContext({ dbPath });
    runtime.close();

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(String(msg));
    });

    try {
      const repoRoot = path.resolve(process.cwd(), '../..');
      const report = await runDoctor({ cwd: repoRoot, dbPath, json: true });
      expect(report.ok).toBe(true);
      expect(report.checks.every((check) => check.status === 'pass')).toBe(true);
      const parsed = JSON.parse(logs[0] ?? '{}');
      expect(parsed.ok).toBe(true);
      expect(parsed.checks.find((c: { id: string }) => c.id === 'governance_db')?.status).toBe(
        'pass'
      );
    } finally {
      spy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    }
  });

  it('fails closed when PLAN.md and MASTER_PLAN_V3.md drift', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-doctor-drift-'));
    fs.writeFileSync(path.join(tempDir, 'PLAN.md'), 'plan-a', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'MASTER_PLAN_V3.md'), 'plan-b', 'utf8');
    fs.mkdirSync(path.join(tempDir, 'fixtures'));
    fs.writeFileSync(path.join(tempDir, 'fixtures', 'sample.json'), '{}', 'utf8');

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const prevExitCode = process.exitCode;
    try {
      const report = await runDoctor({ cwd: tempDir });
      expect(report.ok).toBe(false);
      expect(report.checks.find((c) => c.id === 'plan_mirror')?.status).toBe('fail');
    } finally {
      process.exitCode = prevExitCode;
      spy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    }
  });
});
