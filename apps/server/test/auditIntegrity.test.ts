import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GevEvents } from '@gev/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

const tempDirectories: string[] = [];

function tempDatabase(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-server-audit-'));
  tempDirectories.push(directory);
  return path.join(directory, 'governance.sqlite');
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
});

describe('protected audit integrity inspection', () => {
  it('returns the validated durable chain checkpoint', async () => {
    const context = createApp({ governanceDbPath: tempDatabase() });
    try {
      const response = await context.app.request('/ops/audit/integrity');
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: 'valid',
        chain_version: 'gev.audit.chain.v1',
        schema_version: 4,
        anchor_sequence: 0,
        head_sequence: 0,
      });
    } finally {
      context.governanceContext.close();
    }
  });

  it('reports post-startup tampering without returning suspect payloads or repairing it', async () => {
    const dbPath = tempDatabase();
    const context = createApp({ governanceDbPath: dbPath });
    context.auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: crypto.randomUUID(),
      ts: context.clock.iso(),
      actor: 'system',
      action: 'audit.server_test',
      target: 'server-test',
      task_ref: 'task-5.1.5-server-test',
    });
    const tamper = new DatabaseSync(dbPath);
    try {
      tamper.exec('DROP TRIGGER governance_audit_events_immutable_update;');
      tamper
        .prepare("UPDATE audit_events SET target = 'suspect-private-payload' WHERE rowid = 1")
        .run();
      const response = await context.app.request('/ops/audit/integrity');
      expect(response.status).toBe(409);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        status: 'invalid',
        failure_code: 'PAYLOAD_HASH_MISMATCH',
        failure_sequence: 1,
      });
      expect(JSON.stringify(body)).not.toContain('suspect-private-payload');
    } finally {
      tamper.close();
      context.governanceContext.close();
    }
  });
});
