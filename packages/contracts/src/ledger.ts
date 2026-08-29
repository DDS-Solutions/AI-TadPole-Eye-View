import { z } from 'zod';
import {
  Actor,
  AuditIntent,
  type AuditIntent as AuditIntentType,
  AuditOutcome,
  type AuditOutcome as AuditOutcomeType,
  CostEstimate,
  TripCode,
} from './ports.js';

export const M3_LEDGER_CONTRACT_VERSION = 'gev.m3.ledger.v1' as const;
export const M3_FINGERPRINT_VERSION = 'gev.m3.fingerprint.v1' as const;
export const MAX_LEDGER_RESULT_BYTES = 256 * 1024;
export const MAX_SAFE_MICRO_USD = Number.MAX_SAFE_INTEGER;

export const LedgerOperationStateSchema = z.enum([
  'RESERVED',
  'EXECUTING',
  'SETTLED',
  'REFUNDED',
  'IN_DOUBT',
  'DENIED',
]);
export type LedgerOperationState = z.infer<typeof LedgerOperationStateSchema>;

export const LedgerEvidenceSchema = z
  .object({
    kind: z.enum(['operator_attestation', 'provider_receipt', 'local_log']),
    reference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/)
      .nullable(),
    summary: z.string().trim().min(1).max(2048),
  })
  .strict();
export type LedgerEvidence = z.infer<typeof LedgerEvidenceSchema>;

export const LedgerFingerprintComponentsSchema = z
  .object({
    contract_version: z.literal(M3_LEDGER_CONTRACT_VERSION),
    fingerprint_version: z.literal(M3_FINGERPRINT_VERSION),
    actor: Actor,
    tenant_id: z.string().min(1).max(128).nullable(),
    action: z.string().min(3).max(128),
    input: z.unknown(),
    task_ref: z.string().min(1).max(256),
    is_mutating: z.boolean(),
    estimate: CostEstimate,
  })
  .strict()
  .superRefine((components, context) => {
    const maxUsd = MAX_SAFE_MICRO_USD / 1_000_000;
    if (components.estimate.min > maxUsd || components.estimate.max > maxUsd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimate'],
        message: 'ledger estimate exceeds the safe micro-USD range',
      });
    }
  });
export type LedgerFingerprintComponents = z.infer<typeof LedgerFingerprintComponentsSchema>;

const SafeMicroUsdSchema = z.number().int().min(0).max(MAX_SAFE_MICRO_USD);

export const LedgerOperationSchema = z
  .object({
    operation_id: z.string().uuid(),
    intent_id: z.string().uuid(),
    contract_version: z.literal(M3_LEDGER_CONTRACT_VERSION),
    fingerprint_version: z.literal(M3_FINGERPRINT_VERSION),
    request_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    fingerprint_components: LedgerFingerprintComponentsSchema,
    state: LedgerOperationStateSchema,
    reserved_microusd: SafeMicroUsdSchema,
    settled_microusd: SafeMicroUsdSchema,
    period_start: z.string().datetime(),
    deadline_at: z.string().datetime(),
    created_at: z.string().datetime(),
    execution_started_at: z.string().datetime().nullable(),
    terminal_at: z.string().datetime().nullable(),
    terminal_result: z.unknown().nullable(),
    terminal_result_digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    evidence: LedgerEvidenceSchema.nullable(),
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.operation_id !== operation.intent_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['intent_id'],
        message: 'operation_id and intent_id must be identical',
      });
    }
  });
export type LedgerOperation = z.infer<typeof LedgerOperationSchema>;

export const LedgerReservationRequestSchema = z
  .object({
    operation_id: z.string().uuid(),
    fingerprint_components: LedgerFingerprintComponentsSchema,
    deadline_at: z.string().datetime(),
    audit_intent: AuditIntent,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.operation_id !== request.audit_intent.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit_intent', 'id'],
        message: 'operation_id must equal audit intent id',
      });
    }
    if (
      request.audit_intent.actor !== request.fingerprint_components.actor ||
      request.audit_intent.action !== request.fingerprint_components.action ||
      request.audit_intent.task_ref !== request.fingerprint_components.task_ref
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit_intent'],
        message: 'audit intent actor, action, and task_ref must match fingerprint components',
      });
    }
  });
export type LedgerReservationRequest = z.infer<typeof LedgerReservationRequestSchema>;

export const LedgerReservationResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reserved'), operation: LedgerOperationSchema }),
  z.object({ kind: z.literal('replay'), operation: LedgerOperationSchema }),
  z.object({ kind: z.literal('in_progress'), operation: LedgerOperationSchema }),
  z.object({ kind: z.literal('in_doubt'), operation: LedgerOperationSchema }),
  z.object({
    kind: z.literal('denied'),
    operation: LedgerOperationSchema,
    reason: TripCode,
    message: z.string().min(1),
  }),
  z.object({
    kind: z.literal('conflict'),
    operation: LedgerOperationSchema,
    message: z.string().min(1),
  }),
]);
export type LedgerReservationResult = z.infer<typeof LedgerReservationResultSchema>;

const LedgerTerminalShape = {
  operation_id: z.string().uuid(),
  request_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  actual_microusd: SafeMicroUsdSchema,
  terminal_result: z.unknown(),
  audit_outcome: AuditOutcome,
} as const;

function refineLedgerTerminal(
  request: { operation_id: string; audit_outcome: AuditOutcomeType },
  context: z.RefinementCtx
): void {
  if (request.operation_id !== request.audit_outcome.intent_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['audit_outcome', 'intent_id'],
      message: 'operation_id must equal audit outcome intent_id',
    });
  }
}

export const LedgerTerminalRequestSchema = z
  .object(LedgerTerminalShape)
  .strict()
  .superRefine(refineLedgerTerminal);
export type LedgerTerminalRequest = z.infer<typeof LedgerTerminalRequestSchema>;

export const LedgerRefundRequestSchema = z
  .object({ ...LedgerTerminalShape, evidence: LedgerEvidenceSchema.nullable() })
  .strict()
  .superRefine(refineLedgerTerminal);
export type LedgerRefundRequest = z.infer<typeof LedgerRefundRequestSchema>;

export const LedgerInDoubtRequestSchema = z
  .object({
    operation_id: z.string().uuid(),
    request_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(1).max(1024),
    audit_outcome: AuditOutcome,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.operation_id !== request.audit_outcome.intent_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit_outcome', 'intent_id'],
        message: 'operation_id must equal audit outcome intent_id',
      });
    }
  });
export type LedgerInDoubtRequest = z.infer<typeof LedgerInDoubtRequestSchema>;

const LedgerReconciliationShape = {
  operation_id: z.string().uuid(),
  resolution: z.enum(['settled', 'refunded']),
  actual_usd: z
    .number()
    .finite()
    .nonnegative()
    .max(MAX_SAFE_MICRO_USD / 1_000_000)
    .nullable(),
  evidence: LedgerEvidenceSchema,
} as const;

function refineLedgerReconciliation(
  request: { resolution: 'settled' | 'refunded'; actual_usd: number | null },
  context: z.RefinementCtx
): void {
  if (request.resolution === 'settled' && request.actual_usd === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['actual_usd'],
      message: 'settled reconciliation requires actual_usd',
    });
  }
  if (request.resolution === 'refunded' && request.actual_usd !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['actual_usd'],
      message: 'refunded reconciliation requires actual_usd=null',
    });
  }
}

export const LedgerReconciliationInputSchema = z
  .object(LedgerReconciliationShape)
  .strict()
  .superRefine(refineLedgerReconciliation);
export type LedgerReconciliationInput = z.infer<typeof LedgerReconciliationInputSchema>;

export const LedgerReconciliationRequestSchema = z
  .object({ ...LedgerReconciliationShape, audit_intent: AuditIntent })
  .strict()
  .superRefine((request, context) => {
    refineLedgerReconciliation(request, context);
    if (request.audit_intent.actor !== 'human') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit_intent', 'actor'],
        message: 'reconciliation audit actor must be human',
      });
    }
    if (request.audit_intent.id === request.operation_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit_intent', 'id'],
        message: 'reconciliation requires a separate audit intent id',
      });
    }
  });
export type LedgerReconciliationRequest = z.infer<typeof LedgerReconciliationRequestSchema>;

export const LedgerReconciliationResponseSchema = z
  .object({
    operation_id: z.string().uuid(),
    state: z.enum(['SETTLED', 'REFUNDED']),
    settled_microusd: SafeMicroUsdSchema,
    terminal_at: z.string().datetime(),
  })
  .strict();
export type LedgerReconciliationResponse = z.infer<typeof LedgerReconciliationResponseSchema>;

export const LedgerRecoveryResultSchema = z.object({
  refunded_operation_ids: z.array(z.string().uuid()),
  in_doubt_operation_ids: z.array(z.string().uuid()),
});
export type LedgerRecoveryResult = z.infer<typeof LedgerRecoveryResultSchema>;

export interface BudgetLedger {
  reserve(request: LedgerReservationRequest): LedgerReservationResult;
  startExecution(operationId: string, requestFingerprint: string): LedgerOperation;
  settle(request: LedgerTerminalRequest): LedgerOperation;
  refund(request: LedgerRefundRequest): LedgerOperation;
  markInDoubt(request: LedgerInDoubtRequest): LedgerOperation;
  reconcile(request: LedgerReconciliationRequest, actor: 'human'): LedgerOperation;
  lookup(operationId: string): LedgerOperation | null;
  recoverExpired(): LedgerRecoveryResult;
  hasInDoubt(): boolean;
}

export type AtomicLedgerAuditIntent = AuditIntentType;
export type AtomicLedgerAuditOutcome = AuditOutcomeType;
