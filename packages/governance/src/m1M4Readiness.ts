import type { AuditEntry, AuditIntegrityStatus, GovernanceAuthority } from '@gev/contracts';
import { GevEvents } from '@gev/contracts';
import { PromptApprovalGate, UnavailableApprovalGate } from './approvalGate.js';
import type { SqliteAuditSink } from './auditSink.js';
import type { GovernanceRuntimeContext } from './runtimeContext.js';
import { LocalM2ApprovalDemoGate, SignedApprovalGate } from './signedApproval.js';

export type M2GateKind =
  | 'signed_approval_gate'
  | 'prompt_gate'
  | 'demo_gate'
  | 'unavailable_gate'
  | 'custom_gate';

export interface M1ToM3ReadinessReport {
  ready: boolean;
  checked_at: string;
  m1_audit_valid: boolean;
  m1_verified_entries: number;
  m2_gate_kind: M2GateKind;
  m2_verified: boolean;
  m3_stasis_active: boolean;
  m3_has_in_doubt: boolean;
  m3_authority: GovernanceAuthority;
  m3_verified: boolean;
  failures: string[];
}

export interface M1ToM3ReadinessOptions {
  /** Rejects demo or unavailable approval gates when true (default: true). */
  requireSignedApprovalGate?: boolean;
  /** Requires a file-backed shared SQLite authority rather than :memory: (default: false). */
  requireSharedAuthority?: boolean;
}

export type M1M4ReadinessFailureCode =
  | 'M1_AUDIT_CHAIN_INVALID'
  | 'M2_SIGNED_APPROVAL_REQUIRED'
  | 'M3_STASIS_ACTIVE'
  | 'M3_IN_DOUBT_OPERATIONS'
  | 'M3_LOCAL_ONLY_AUTHORITY';

export class M1M4ReadinessError extends Error {
  constructor(
    readonly code: M1M4ReadinessFailureCode,
    message: string,
    readonly report: M1ToM3ReadinessReport
  ) {
    super(message);
    this.name = 'M1M4ReadinessError';
  }
}

export interface IndependentAuditVerificationResult {
  integrity: AuditIntegrityStatus;
  verified_entries: number;
  intent_count: number;
  outcome_count: number;
  paired_outcomes: number;
  orphan_outcomes: string[];
  missing_required_actions: string[];
  valid: boolean;
}

function classifyM2Gate(approvalGate: GovernanceRuntimeContext['approvalGate']): M2GateKind {
  if (approvalGate instanceof SignedApprovalGate) {
    return 'signed_approval_gate';
  }
  if (approvalGate instanceof PromptApprovalGate) {
    return 'prompt_gate';
  }
  if (approvalGate instanceof LocalM2ApprovalDemoGate) {
    return 'demo_gate';
  }
  if (approvalGate instanceof UnavailableApprovalGate) {
    return 'unavailable_gate';
  }
  return 'custom_gate';
}

/**
 * Inspects M1 (hash-chained SQLite audit), M2 (signed approval gate), and
 * M3 (shared budget ledger & STASIS) readiness prior to M4 Tadpole execution.
 */
export function inspectM1ToM3Readiness(
  context: GovernanceRuntimeContext,
  options: M1ToM3ReadinessOptions = {}
): M1ToM3ReadinessReport {
  const requireSignedApprovalGate = options.requireSignedApprovalGate ?? true;
  const requireSharedAuthority = options.requireSharedAuthority ?? false;

  const integrity = context.auditSink.verifyIntegrity();
  const m1AuditValid = integrity.status === 'valid';
  const m2GateKind = classifyM2Gate(context.approvalGate);
  const m2Verified = requireSignedApprovalGate
    ? m2GateKind === 'signed_approval_gate'
    : m2GateKind !== 'unavailable_gate';

  const governorState = context.budgetGovernor.state();
  const m3StasisActive = governorState.stasis_active;
  const m3HasInDoubt = context.budgetLedger.hasInDoubt();
  const m3Authority = context.authority();
  const m3AuthorityOk = !requireSharedAuthority || m3Authority.authoritative;
  const m3Verified = !m3StasisActive && !m3HasInDoubt && m3AuthorityOk;

  const failures: string[] = [];
  if (!m1AuditValid) {
    failures.push(`M1 audit integrity invalid (${integrity.failure_code ?? integrity.status})`);
  }
  if (!m2Verified) {
    failures.push(`M2 requires an active SignedApprovalGate (found ${m2GateKind})`);
  }
  if (m3StasisActive) {
    failures.push('M3 STASIS lock is active; human resume required before M4 execution');
  }
  if (m3HasInDoubt) {
    failures.push('M3 ledger has unresolved IN_DOUBT operations; human reconciliation required');
  }
  if (!m3AuthorityOk) {
    failures.push('M3 requires shared SQLite authority (not in-memory process_local)');
  }

  return {
    ready: failures.length === 0,
    checked_at: context.clock.iso(),
    m1_audit_valid: m1AuditValid,
    m1_verified_entries: integrity.verified_entries,
    m2_gate_kind: m2GateKind,
    m2_verified: m2Verified,
    m3_stasis_active: m3StasisActive,
    m3_has_in_doubt: m3HasInDoubt,
    m3_authority: m3Authority,
    m3_verified: m3Verified,
    failures,
  };
}

/**
 * Enforces M1 -> M2 -> M3 prerequisites fail-closed prior to M4 agent promotion or dispatch.
 */
export function assertM1ToM3Prerequisites(
  context: GovernanceRuntimeContext,
  options: M1ToM3ReadinessOptions = {}
): M1ToM3ReadinessReport {
  const report = inspectM1ToM3Readiness(context, options);
  if (report.ready) {
    return report;
  }

  if (!report.m1_audit_valid) {
    throw new M1M4ReadinessError('M1_AUDIT_CHAIN_INVALID', report.failures.join('; '), report);
  }
  if (!report.m2_verified) {
    throw new M1M4ReadinessError('M2_SIGNED_APPROVAL_REQUIRED', report.failures.join('; '), report);
  }
  if (report.m3_stasis_active) {
    throw new M1M4ReadinessError('M3_STASIS_ACTIVE', report.failures.join('; '), report);
  }
  if (report.m3_has_in_doubt) {
    throw new M1M4ReadinessError('M3_IN_DOUBT_OPERATIONS', report.failures.join('; '), report);
  }
  throw new M1M4ReadinessError('M3_LOCAL_ONLY_AUTHORITY', report.failures.join('; '), report);
}

/**
 * Independently verifies both the durable SQLite cryptographic hash chain and
 * intent/outcome pairing across recent audit WAL entries.
 */
export function verifyIndependentAuditChain(
  auditSink: SqliteAuditSink,
  options: { limit?: number; requiredActions?: readonly string[] } = {}
): IndependentAuditVerificationResult {
  const integrity = auditSink.verifyIntegrity();
  const limit = options.limit ?? 500;
  const entries: AuditEntry[] = auditSink.tail({ limit });

  const intentIds = new Set<string>();
  const recordedActions = new Set<string>();
  const outcomes: Extract<AuditEntry, { kind: typeof GevEvents.AuditOutcome }>[] = [];

  for (const entry of entries) {
    if (entry.kind === GevEvents.AuditIntent) {
      intentIds.add(entry.id);
      recordedActions.add(entry.action);
    } else if (entry.kind === GevEvents.AuditOutcome) {
      outcomes.push(entry);
    }
  }

  const orphanOutcomes = outcomes
    .filter((o) => !intentIds.has(o.intent_id))
    .map((o) => o.intent_id);
  const missingRequiredActions = (options.requiredActions ?? []).filter(
    (action) => !recordedActions.has(action)
  );
  const pairedOutcomes = outcomes.length - orphanOutcomes.length;

  return {
    integrity,
    verified_entries: integrity.verified_entries,
    intent_count: intentIds.size,
    outcome_count: outcomes.length,
    paired_outcomes: pairedOutcomes,
    orphan_outcomes: orphanOutcomes,
    missing_required_actions: missingRequiredActions,
    valid:
      integrity.status === 'valid' &&
      orphanOutcomes.length === 0 &&
      missingRequiredActions.length === 0,
  };
}
