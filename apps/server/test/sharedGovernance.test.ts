import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SystemHealthResponseSchema } from '@gev/contracts';
import { createGovernanceRuntimeContext } from '@gev/governance';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/index.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('server shared governance runtime composition', () => {
  it('uses one injected context and rereads durable state changed by another connection', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-server-governance-'));
    tempDirectories.push(directory);
    const dbPath = path.join(directory, 'governance.sqlite');
    const serverRuntime = createGovernanceRuntimeContext({ dbPath, capUsd: 1 });
    const externalRuntime = createGovernanceRuntimeContext({ dbPath });
    const context = createApp({ governanceContext: serverRuntime });

    expect(context.governanceContext).toBe(serverRuntime);
    expect(context.auditSink).toBe(serverRuntime.auditSink);
    expect(context.budgetGovernor).toBe(serverRuntime.budgetGovernor);
    externalRuntime.budgetGovernor.recordSpend(1);

    const response = await context.app.request('/api/health');
    const health = SystemHealthResponseSchema.parse(await response.json());
    expect(health).toMatchObject({
      stasis_active: true,
      budget_spent_usd: 1,
      budget_cap_usd: 1,
      governance_authority: {
        kind: 'shared_sqlite',
        authoritative: true,
      },
    });

    externalRuntime.close();
    serverRuntime.close();
  });
});
