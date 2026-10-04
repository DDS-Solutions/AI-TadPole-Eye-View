import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GevEvents } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectAuditIntegrity } from '../src/auditChainStore.js';
import type { AuditRetentionSigner, TrustedAuditRetentionKey } from '../src/auditRetention.js';
import type { SqliteAuditSink } from '../src/auditSink.js';
import { createGovernanceRuntimeContext } from '../src/runtimeContext.js';

const START = 1_700_000_000_000;
const tempDirectories: string[] = [];

function tempDatabase(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-audit-retention-'));
  tempDirectories.push(directory);
  return path.join(directory, 'governance.sqlite');
}

function removeTempDirectory(directory: string): void {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
      return;
    } catch {
      if (attempt === 2)
        throw new Error(`Could not remove closed audit test directory: ${directory}`);
    }
  }
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) removeTempDirectory(directory);
});

function appendIntent(sink: SqliteAuditSink, clock: FrozenClock, index: number): string {
  const id = crypto.randomUUID();
  sink.intent({
    kind: GevEvents.AuditIntent,
    id,
    ts: clock.iso(),
    actor: 'system',
    action: 'audit.test.append',
    target: `fixture-${index}`,
    params: { index },
    task_ref: 'task-5.1.5-test',
  });
  clock.setTime(clock.now() + 1);
  return id;
}

function signingProfile(): {
  signer: AuditRetentionSigner;
  trustedKey: TrustedAuditRetentionKey;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const signerId = 'audit-retention-operator';
  const keyId = 'audit-retention-key-1';
  return {
    signer: {
      signerId,
      keyId,
      sign: (payload) => crypto.sign(null, Buffer.from(payload), privateKey),
    },
    trustedKey: {
      signerId,
      keyId,
      publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      status: 'active',
    },
  };
}

describe('audit retention guards & historical verification', () => {
  it('guarantees retention_active guard resets to 0 via finally block on throw (C-04)', () => {
    const dbPath = tempDatabase();
    const clock = new FrozenClock(START);
    const { signer, trustedKey } = signingProfile();
    const runtime = createGovernanceRuntimeContext({
      dbPath,
      clock,
      auditIntegrity: {
        trustedRetentionKeys: [trustedKey],
        retentionPolicy: { minimumRetainedEntries: 1, maximumPruneEntries: 20 },
      },
    });

    for (let index = 0; index < 5; index += 1) appendIntent(runtime.auditSink, clock, index);

    // Intentionally pass an invalid cutoff beyond the chain boundary
    expect(() =>
      runtime.auditSink.retain({
        actor: 'human',
        pruneThroughSequence: 999,
        reason: 'Should fail with boundary error',
        signer,
      })
    ).toThrow();

    // Verify guard was reset: appendStorageRow succeeds rather than failing on active retention
    expect(() => appendIntent(runtime.auditSink, clock, 99)).not.toThrow();
    runtime.close();
  });

  it('allows historical receipts with retired keys and revoked keys before revokedAt (C-14)', () => {
    const dbPath = tempDatabase();
    const clock = new FrozenClock(START);
    const { signer, trustedKey } = signingProfile();
    const runtime = createGovernanceRuntimeContext({
      dbPath,
      clock,
      auditIntegrity: {
        trustedRetentionKeys: [trustedKey],
        retentionPolicy: { minimumRetainedEntries: 1, maximumPruneEntries: 20 },
      },
    });

    for (let index = 0; index < 5; index += 1) appendIntent(runtime.auditSink, clock, index);

    // Perform valid retention prune at START
    runtime.auditSink.retain({
      actor: 'human',
      pruneThroughSequence: 2,
      reason: 'Routine compliance prune before key retirement',
      signer,
    });
    runtime.close();

    // 1. Key is now 'retired' (e.g. rotated) — historical receipts must remain valid
    const retiredKey = { ...trustedKey, status: 'retired' as const };
    expect(
      inspectAuditIntegrity({ dbPath, clock, trustedRetentionKeys: [retiredKey] }).status
    ).toBe('valid');

    // 2. Key is 'revoked' with revokedAt in the future — historical receipt is valid
    const revokedLaterKey = {
      ...trustedKey,
      status: 'revoked' as const,
      revokedAt: new Date(START + 60_000).toISOString(),
    };
    expect(
      inspectAuditIntegrity({ dbPath, clock, trustedRetentionKeys: [revokedLaterKey] }).status
    ).toBe('valid');

    // 3. Key is 'revoked' with revokedAt before the receipt approved_at — invalid
    const revokedEarlierKey = {
      ...trustedKey,
      status: 'revoked' as const,
      revokedAt: new Date(START - 60_000).toISOString(),
    };
    expect(
      inspectAuditIntegrity({ dbPath, clock, trustedRetentionKeys: [revokedEarlierKey] })
    ).toMatchObject({
      status: 'invalid',
      failure_code: 'RETENTION_SIGNATURE_INVALID',
    });
  });

  it('rejects audit retention if actor is not human (C-05)', () => {
    const dbPath = tempDatabase();
    const clock = new FrozenClock(START);
    const { signer, trustedKey } = signingProfile();
    const runtime = createGovernanceRuntimeContext({
      dbPath,
      clock,
      auditIntegrity: {
        trustedRetentionKeys: [trustedKey],
        retentionPolicy: { minimumRetainedEntries: 1, maximumPruneEntries: 20 },
      },
    });

    for (let index = 0; index < 5; index += 1) appendIntent(runtime.auditSink, clock, index);

    try {
      expect(() =>
        runtime.auditSink.retain({
          // Non-human actor must be rejected by runtime assertion
          actor: 'agent' as unknown as 'human',
          pruneThroughSequence: 2,
          reason: 'Automated pruning attempted by agent',
          signer,
        })
      ).toThrow();
    } finally {
      runtime.close();
    }
  });
});
