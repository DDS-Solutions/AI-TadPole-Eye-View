import { GevEvents } from '@gev/contracts';
import { SystemClock } from '@gev/core';
import { CapBudgetGovernor, SqliteAuditSink } from '@gev/governance';
import pc from 'picocolors';

export interface ResumeOptions {
  serverUrl?: string;
}

export async function runResume(reason?: string, options: ResumeOptions = {}): Promise<void> {
  const serverUrl = options.serverUrl ?? 'http://localhost:3000';
  const resumptionReason = reason ?? 'Human operator manual override via gev resume';

  // Try the running server first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const opsToken = process.env.GEV_OPS_TOKEN ?? '';
    const res = await fetch(`${serverUrl}/ops/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opsToken ? { Authorization: `Bearer ${opsToken}` } : {}),
      },
      body: JSON.stringify({ reason: resumptionReason }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as { status: string; message?: string };
      console.log(pc.bold(pc.green('\n✔ STASIS LIFTED: System resumed via server.')));
      console.log(` Reason: ${resumptionReason}`);
      console.log(pc.dim(` Server: ${data.message ?? 'Confirmed resume with audit trail'}\n`));
      return;
    }

    const errData = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
      error?: string;
    };
    console.log(pc.yellow(`\nServer returned ${res.status}: ${errData.error ?? 'Unknown'}`));
    console.log(pc.dim('Falling back to local governance state.\n'));
  } catch {
    console.log(pc.dim('Server offline. Using local governance state.\n'));
  }

  // Offline fallback: use shared on-disk SQLite
  const clock = new SystemClock();
  const auditSink = new SqliteAuditSink({ clock });
  const governor = new CapBudgetGovernor({ clock });

  const state = governor.state();
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
  governor.resume('human');

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
}
