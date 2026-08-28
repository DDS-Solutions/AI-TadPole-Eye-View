import type { ApprovalGate, GovernanceAuthority } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { PromptApprovalGate } from './approvalGate.js';
import { SqliteAuditSink } from './auditSink.js';
import { CapBudgetGovernor } from './budgetGovernor.js';
import { GOVERNANCE_SCHEMA_VERSION, resolveGovernanceDbPath } from './governanceDb.js';

export interface GovernanceRuntimeContext {
  clock: SimClock;
  auditSink: SqliteAuditSink;
  budgetGovernor: CapBudgetGovernor;
  approvalGate: ApprovalGate;
  authority(): GovernanceAuthority;
  close(): void;
}

export interface GovernanceRuntimeContextOptions {
  clock?: SimClock;
  dbPath?: string;
  capUsd?: number;
  spentUsd?: number;
  warnThresholdPct?: number;
  auditSink?: SqliteAuditSink;
  budgetGovernor?: CapBudgetGovernor;
  approvalGate?: ApprovalGate;
}

export function createGovernanceRuntimeContext(
  options: GovernanceRuntimeContextOptions = {}
): GovernanceRuntimeContext {
  const clock = options.clock ?? new SystemClock();
  const dbPath = resolveGovernanceDbPath(options.dbPath);
  const ownsAuditSink = options.auditSink === undefined;
  const auditSink = options.auditSink ?? new SqliteAuditSink({ clock, dbPath });
  let budgetGovernor: CapBudgetGovernor;
  try {
    budgetGovernor =
      options.budgetGovernor ??
      new CapBudgetGovernor({
        clock,
        dbPath,
        capUsd: options.capUsd,
        spentUsd: options.spentUsd,
        warnThresholdPct: options.warnThresholdPct,
      });
  } catch (error) {
    if (ownsAuditSink) {
      auditSink.close();
    }
    throw error;
  }
  const approvalGate = options.approvalGate ?? new PromptApprovalGate({ clock });

  let closed = false;
  return {
    clock,
    auditSink,
    budgetGovernor,
    approvalGate,
    authority: () => ({
      kind: budgetGovernor.isSharedAuthority() ? 'shared_sqlite' : 'process_local',
      authoritative: budgetGovernor.isSharedAuthority(),
      schema_version: GOVERNANCE_SCHEMA_VERSION,
      state_revision: budgetGovernor.stateRevision(),
    }),
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      auditSink.close();
      budgetGovernor.close();
    },
  };
}
