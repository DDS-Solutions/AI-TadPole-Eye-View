import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteAuditSink } from '../src/auditSink.js';

const tempDirectories: string[] = [];
const childFixture = path.resolve(import.meta.dirname, 'fixtures', 'auditProcess.ts');

function tempDatabase(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-audit-process-'));
  tempDirectories.push(directory);
  return path.join(directory, 'governance.sqlite');
}

function appendInChild(dbPath: string, label: string, iterations: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [childFixture, dbPath, label, String(iterations)], {
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
      if (code === 0) resolve();
      else reject(new Error(`Audit child exited ${code}: ${stderr}`));
    });
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
});

describe('two-process durable audit append chain', () => {
  it('serializes shared writers into one continuous chain without a fork', async () => {
    const dbPath = tempDatabase();
    const initialized = new SqliteAuditSink({ dbPath });
    initialized.close();

    await Promise.all([
      appendInChild(dbPath, 'writer-a', 40),
      appendInChild(dbPath, 'writer-b', 40),
    ]);

    const observer = new SqliteAuditSink({ dbPath });
    expect(observer.verifyIntegrity()).toMatchObject({
      status: 'valid',
      head_sequence: 80,
      verified_entries: 80,
    });
    observer.close();

    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect(
      db
        .prepare(`SELECT COUNT(*) AS count, COUNT(DISTINCT sequence) AS sequences,
        COUNT(DISTINCT chain_hash) AS hashes FROM governance_audit_chain`)
        .get()
    ).toEqual({ count: 80, sequences: 80, hashes: 80 });
    db.close();
  });
});
