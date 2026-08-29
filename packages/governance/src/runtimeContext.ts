import type { ApprovalGate, GovernanceAuthority } from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { PromptApprovalGate, UnavailableApprovalGate } from './approvalGate.js';
import { SqliteAuditSink } from './auditSink.js';
import { CapBudgetGovernor } from './budgetGovernor.js';
import { SqliteBudgetLedger } from './budgetLedger.js';
import {
  GOVERNANCE_SCHEMA_VERSION,
  openGovernanceDatabase,
  resolveGovernanceDbPath,
} from './governanceDb.js';
import {
  SignedApprovalGate,
  type SignedApprovalProvider,
  SqliteApprovalNonceStore,
  type TrustedApprovalKey,
} from './signedApproval.js';

export interface GovernanceRuntimeContext {
  clock: SimClock;
  auditSink: SqliteAuditSink;
  budgetGovernor: CapBudgetGovernor;
  budgetLedger: SqliteBudgetLedger;
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
  budgetLedger?: SqliteBudgetLedger;
  approvalGate?: ApprovalGate;
  signedApproval?: {
    provider: SignedApprovalProvider;
    trustedKeys: readonly TrustedApprovalKey[];
    maxLifetimeMs?: number;
    clockSkewMs?: number;
  };
}

export function createGovernanceRuntimeContext(
  options: GovernanceRuntimeContextOptions = {}
): GovernanceRuntimeContext {
  if (options.approvalGate && options.signedApproval) {
    throw new Error('Configure either approvalGate or signedApproval, not both');
  }
  const customLocalPorts = [options.auditSink, options.budgetGovernor, options.budgetLedger];
  if (customLocalPorts.some(Boolean) && !customLocalPorts.every(Boolean)) {
    throw new Error(
      'Custom local governance composition requires auditSink, budgetGovernor, and budgetLedger together'
    );
  }
  const clock = options.clock ?? new SystemClock();
  const dbPath = resolveGovernanceDbPath(options.dbPath);
  const opened = customLocalPorts.every(Boolean)
    ? undefined
    : openGovernanceDatabase({ dbPath, clock });
  const ownsAuditSink = options.auditSink === undefined;
  const ownsBudgetGovernor = options.budgetGovernor === undefined;
  const ownsBudgetLedger = options.budgetLedger === undefined;
  const auditSink = options.auditSink ?? new SqliteAuditSink({ clock, db: opened?.db, dbPath });
  let budgetGovernor: CapBudgetGovernor;
  let budgetLedger!: SqliteBudgetLedger;
  try {
    budgetGovernor =
      options.budgetGovernor ??
      new CapBudgetGovernor({
        clock,
        dbPath,
        db: opened?.db,
        resolvedDbPath: opened?.dbPath,
        capUsd: options.capUsd,
        spentUsd: options.spentUsd,
        warnThresholdPct: options.warnThresholdPct,
      });
    budgetLedger =
      options.budgetLedger ??
      new SqliteBudgetLedger({
        clock,
        dbPath,
        db: opened?.db,
        publishCommittedAudit: (entry) => auditSink.publishCommitted(entry),
      });
    budgetLedger.recoverExpired();
  } catch (error) {
    if (ownsBudgetLedger) {
      budgetLedger?.close();
    }
    if (ownsAuditSink) {
      auditSink.close();
    }
    opened?.db.close();
    throw error;
  }
  const ownsApprovalGate = options.approvalGate === undefined;
  let approvalGate: ApprovalGate;
  try {
    approvalGate =
      options.approvalGate ??
      (options.signedApproval
        ? createSignedApprovalGate(options.signedApproval, clock, dbPath)
        : process.env.NODE_ENV === 'production'
          ? new UnavailableApprovalGate(clock)
          : new PromptApprovalGate({ clock }));
  } catch (error) {
    if (ownsBudgetGovernor) {
      budgetGovernor.close();
    }
    if (ownsAuditSink) {
      auditSink.close();
    }
    throw error;
  }

  let closed = false;
  return {
    clock,
    auditSink,
    budgetGovernor,
    budgetLedger,
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
      if (ownsApprovalGate && approvalGate instanceof SignedApprovalGate) {
        approvalGate.close();
      }
      auditSink.close();
      budgetGovernor.close();
      budgetLedger.close();
      opened?.db.close();
    },
  };
}

function createSignedApprovalGate(
  options: NonNullable<GovernanceRuntimeContextOptions['signedApproval']>,
  clock: SimClock,
  dbPath: string
): SignedApprovalGate {
  const nonceStore = new SqliteApprovalNonceStore({ clock, dbPath });
  try {
    return new SignedApprovalGate({
      clock,
      provider: options.provider,
      trustedKeys: options.trustedKeys,
      nonceStore,
      maxLifetimeMs: options.maxLifetimeMs,
      clockSkewMs: options.clockSkewMs,
    });
  } catch (error) {
    nonceStore.close();
    throw error;
  }
}
