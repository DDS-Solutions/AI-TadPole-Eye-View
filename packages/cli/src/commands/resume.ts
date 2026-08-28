import { GevEvents } from '@gev/contracts';
import { SystemClock } from '@gev/core';
import { createGovernanceRuntimeContext } from '@gev/governance';
import pc from 'picocolors';

export interface ResumeOptions {
  serverUrl?: string;
  governanceDbPath?: string;
}

function isLoopbackServerUrl(serverUrl: string): boolean {
  try {
    const hostname = new URL(serverUrl).hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1'
    );
  } catch {
    return false;
  }
}

export async function runResume(reason?: string, options: ResumeOptions = {}): Promise<void> {
  const serverUrl = options.serverUrl ?? 'http://localhost:3000';
  const resumptionReason = reason ?? 'Human operator manual override via gev resume';

  // Try the running server first
  let serverResponse: Response | undefined;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const opsToken = process.env.GEV_OPS_TOKEN ?? '';
    try {
      serverResponse = await fetch(`${serverUrl}/ops/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(opsToken ? { Authorization: `Bearer ${opsToken}` } : {}),
        },
        body: JSON.stringify({ reason: resumptionReason }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (!isLoopbackServerUrl(serverUrl)) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot verify remote server state; refusing local resume: ${detail}`);
    }
    console.log(pc.dim('Server offline. Using local durable governance state.\n'));
  }

  if (serverResponse) {
    if (serverResponse.ok) {
      const data = (await serverResponse.json()) as { status: string; message?: string };
      console.log(pc.bold(pc.green('\n✔ STASIS LIFTED: System resumed via server.')));
      console.log(` Reason: ${resumptionReason}`);
      console.log(pc.dim(` Server: ${data.message ?? 'Confirmed resume with audit trail'}\n`));
      return;
    }

    const errData = (await serverResponse.json().catch(() => ({
      error: `HTTP ${serverResponse?.status ?? 'unknown'}`,
    }))) as {
      error?: string;
    };
    throw new Error(
      `Server refused STASIS resume (${serverResponse.status}): ${errData.error ?? 'Unknown'}`
    );
  }

  // Offline human-operated path uses the same durable SQLite authority.
  const clock = new SystemClock();
  const governanceContext = createGovernanceRuntimeContext({
    clock,
    dbPath: options.governanceDbPath,
  });
  const { auditSink, budgetGovernor } = governanceContext;

  try {
    if (!governanceContext.authority().authoritative) {
      throw new Error('Offline resume requires durable shared SQLite governance state');
    }
    const state = budgetGovernor.state();
    if (!state.stasis_active) {
      console.log(pc.yellow('\nℹ STASIS is not currently active. System is running normally.\n'));
      return;
    }

    // Rule 1: Audit intent BEFORE mutation
    const now = new Date(clock.now()).toISOString();
    const intentId = crypto.randomUUID();
    auditSink.intent({
      kind: GevEvents.AuditIntent,
      id: intentId,
      ts: now,
      actor: 'human',
      action: 'governance.resume',
      target: 'stasis.lock',
      params: { reason: resumptionReason },
      task_ref: 'human-resume-override',
    });

    // Execute mutation
    budgetGovernor.resume('human');

    // Rule 1: Audit outcome AFTER mutation
    auditSink.outcome({
      kind: GevEvents.AuditOutcome,
      intent_id: intentId,
      ts: new Date(clock.now()).toISOString(),
      status: 'ok',
      result: { resumed: true, reason: resumptionReason },
      duration_ms: clock.now() - new Date(now).getTime(),
    });

    console.log(pc.bold(pc.green('\n✔ STASIS LIFTED: System resumed by human operator.')));
    console.log(` Reason: ${resumptionReason}`);
    console.log(pc.dim(' Logged intent + outcome to SQLite Audit WAL.\n'));
  } finally {
    governanceContext.close();
  }
}
