import { GevEvents } from '@gev/contracts';
import { SystemClock } from '@gev/core';
import { CapBudgetGovernor, SqliteAuditSink } from '@gev/governance';
import pc from 'picocolors';

export async function runResume(reason?: string): Promise<void> {
  const clock = new SystemClock();
  const governor = new CapBudgetGovernor({ clock });
  const auditSink = new SqliteAuditSink({ clock });

  const state = governor.state();
  if (!state.stasis_active) {
    console.log(pc.yellow('\nℹ STASIS is not currently active. System is running normally.\n'));
    return;
  }

  const resumptionReason = reason ?? 'Human operator manual override via gev resume';
  governor.resume('human');

  // Log STASIS resumption to Audit WAL (Rule 1)
  const now = new Date(clock.now()).toISOString();
  auditSink.intent({
    kind: GevEvents.AuditIntent,
    id: crypto.randomUUID(),
    ts: now,
    actor: 'human',
    action: 'governance.resume',
    target: 'stasis.lock',
    params: { reason: resumptionReason },
    task_ref: 'human-resume-override',
  });

  console.log(pc.bold(pc.green('\n✔ STASIS LIFTED: System resumed by human operator.')));
  console.log(` Reason: ${resumptionReason}`);
  console.log(pc.dim(' Logged stasis.resumed event to SQLite Audit WAL.\n'));
}
