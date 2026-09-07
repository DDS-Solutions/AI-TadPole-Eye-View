import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LayerAccessReadModelSchema } from '@gev/contracts';
import { FrozenClock } from '@gev/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/index.js';

const temporaryDirectories: string[] = [];
const NOW = Date.parse('2026-09-06T20:00:00.000Z');

function databasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-layer-access-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'governance.sqlite');
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Layer Access authenticated read route', () => {
  it('serves every entry locally with unavailable credential status and audited boundaries', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const runtime = createApp({
      clock: new FrozenClock(NOW),
      governanceDbPath: databasePath(),
      opsAuth: { requireAuth: false },
    });
    const response = await runtime.app.request('/ops/layer-access');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const model = LayerAccessReadModelSchema.parse(await response.json());
    expect(model.entries).toHaveLength(19);
    expect(model.counts.registry).toMatchObject({
      providers: { total: 19, active: 17 },
      feeds: { total: 22, active: 20 },
      layers: { total: 19, active: 16 },
    });
    expect(model.authority).toMatchObject({
      kind: 'local_seed',
      credential_status_access: 'unavailable',
    });
    expect(model.entries.find((entry) => entry.id === 'opensky')?.credential).toMatchObject({
      status: null,
      masked_fingerprint: null,
      local_status: { visibility: 'unavailable' },
    });
    const audit = runtime.auditSink.tailByTaskRef('layer-access-read');
    expect(audit.map((entry) => entry.kind)).toEqual(['audit.intent', 'audit.outcome']);
    expect(JSON.stringify(audit)).not.toMatch(/credential|secret-value/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    runtime.governanceContext.close();
  });

  it('requires configured ops authentication and returns only an injected masked status', async () => {
    const runtime = createApp({
      clock: new FrozenClock(NOW),
      governanceDbPath: databasePath(),
      opsAuth: { requireAuth: true, opsToken: 'local-operator-token' },
      layerAccessAuthorizedLocalState: [
        {
          provider_id: 'opensky',
          credential: {
            status: 'valid',
            masked_fingerprint: '•••••••• A91C',
            validated_at: new Date(NOW).toISOString(),
          },
          terms: { status: 'approved', reviewed_at: new Date(NOW).toISOString(), expires_at: null },
          configuration: { status: 'valid', checked_at: new Date(NOW).toISOString() },
        },
      ],
    });
    expect((await runtime.app.request('/ops/layer-access')).status).toBe(401);
    const response = await runtime.app.request('/ops/layer-access', {
      headers: { Authorization: 'Bearer local-operator-token' },
    });
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).toContain('•••••••• A91C');
    expect(raw).not.toContain('local-operator-token');
    const model = LayerAccessReadModelSchema.parse(JSON.parse(raw));
    expect(model.authority.credential_status_access).toBe('masked_status');
    expect(model.entries.find((entry) => entry.id === 'opensky')).toMatchObject({
      credential: { status: 'valid', masked_fingerprint: '•••••••• A91C' },
      terms: { status: 'approved' },
      configuration: { current_state: 'valid' },
    });
    runtime.governanceContext.close();
  });
});
