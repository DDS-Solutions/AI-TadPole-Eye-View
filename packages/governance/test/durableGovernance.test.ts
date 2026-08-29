import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
import { CapBudgetGovernor } from '../src/budgetGovernor.js';
import { GOVERNANCE_SCHEMA_VERSION } from '../src/governanceDb.js';

const tempDirectories: string[] = [];
const childFixture = path.resolve(import.meta.dirname, 'fixtures', 'governanceProcess.ts');

function makeTempDatabase(): { directory: string; dbPath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-governance-'));
  tempDirectories.push(directory);
  return { directory, dbPath: path.join(directory, 'governance.sqlite') };
}

function runChild(operation: string, dbPath: string, ...args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [childFixture, operation, dbPath, ...args], {
      env: { ...process.env, NODE_ENV: 'test', VITEST: 'true' },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Governance child exited ${code}: ${stderr}`));
      }
    });
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('durable shared budget and STASIS state', () => {
  it('migrates once and preserves budget/STASIS across a restart', () => {
    const { dbPath } = makeTempDatabase();
    const clock = new FrozenClock(1_700_000_000_000);
    const first = new CapBudgetGovernor({ dbPath, capUsd: 2, clock });
    first.recordSpend(2);
    const beforeRestart = first.state();
    const revision = first.stateRevision();
    first.close();

    const restarted = new CapBudgetGovernor({ dbPath, clock });
    expect(restarted.state()).toEqual(beforeRestart);
    expect(restarted.stateRevision()).toBe(revision);
    expect(() => new CapBudgetGovernor({ dbPath, capUsd: 3, clock })).toThrow(
      /does not match persisted cap/
    );
    restarted.close();

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare('SELECT version FROM governance_schema_migrations').all();
    expect(rows).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: GOVERNANCE_SCHEMA_VERSION },
    ]);
    db.close();
  });

  it('serializes two process writers without losing spend updates', async () => {
    const { dbPath } = makeTempDatabase();
    const observer = new CapBudgetGovernor({ dbPath, capUsd: 10 });

    await Promise.all([
      runChild('spend', dbPath, '10000', '100'),
      runChild('spend', dbPath, '10000', '100'),
    ]);

    expect(observer.state().spent_usd).toBe(2);
    expect(observer.stateRevision()).toBe(200);
    observer.close();
  });

  it('rounds sub-micro-dollar costs conservatively instead of treating them as free', () => {
    const governor = new CapBudgetGovernor({ capUsd: 0.000001, dbPath: ':memory:' });
    const verdict = governor.check({
      action: 'provider.micro-charge',
      estimate: { currency: 'usd', min: 0, max: 0.0000001 },
    });
    expect(verdict).toEqual({ allowed: true, remaining_usd: 0 });

    governor.recordSpend(0.0000001);
    expect(governor.state()).toMatchObject({ spent_usd: 0.000001, stasis_active: true });
    governor.close();
  });

  it('observes a child-process trip after abrupt exit and permits only human resume', async () => {
    const { dbPath } = makeTempDatabase();
    const observer = new CapBudgetGovernor({ dbPath, capUsd: 10 });

    await runChild('trip-and-exit', dbPath);
    expect(observer.state()).toMatchObject({
      stasis_active: true,
      last_trip: { code: 'LOGIC_BLOCKER' },
    });
    expect(() => observer.resume('ai')).toThrow(/requires a human actor/);
    expect(observer.state().stasis_active).toBe(true);

    const humanProcess = new CapBudgetGovernor({ dbPath });
    humanProcess.resume('human');
    humanProcess.close();
    expect(observer.state()).toMatchObject({
      stasis_active: false,
      last_trip: { code: 'LOGIC_BLOCKER', resumed_by: 'human' },
    });
    observer.close();
  });

  it('fails closed on a corrupt database instead of creating local state', () => {
    const { dbPath } = makeTempDatabase();
    fs.writeFileSync(dbPath, 'not-a-sqlite-database', 'utf8');

    expect(() => new CapBudgetGovernor({ dbPath })).toThrow(
      /unavailable; refusing process-local fallback/
    );
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('not-a-sqlite-database');
  });
});
