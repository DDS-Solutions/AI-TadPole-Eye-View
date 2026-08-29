import {
  type ApprovalGate,
  type ApprovalResult,
  ApprovalResult as ApprovalResultSchema,
  type BudgetLedger,
  GevEvents,
  type LedgerReservationResult,
  OPERATOR_TOOLS,
  type OperatorToolName,
} from '@gev/contracts';
import type { SimClock } from './clock.js';
import {
  type ToolExecutionContext,
  type ToolExecutionFailureCode,
  type ToolExecutionResult,
  type ToolHandler,
  isHandlerTimeout,
  makeFailure,
  makeSuccess,
  normalizeError,
  readStoredResult,
  runWithTimeout,
  toAuditOutcome,
  toMicrousd,
} from './toolExecutionTypes.js';

export interface ReservedToolExecutionOptions {
  clock: SimClock;
  ledger: BudgetLedger;
  approvalGate?: ApprovalGate;
  idFactory: () => string;
}

export async function executeReservedTool<T>(
  options: ReservedToolExecutionOptions,
  name: OperatorToolName,
  input: unknown,
  handler: ToolHandler,
  context: ToolExecutionContext,
  intentId: string,
  startTime: number
): Promise<ToolExecutionResult<T>> {
  const { clock, ledger } = options;
  const definition = OPERATOR_TOOLS[name];
  const actor = context.actor ?? 'ai';
  const taskRef = context.task_ref ?? 'tool-execution';
  let reservation: LedgerReservationResult;
  try {
    reservation = ledger.reserve({
      operation_id: intentId,
      fingerprint_components: {
        contract_version: 'gev.m3.ledger.v1',
        fingerprint_version: 'gev.m3.fingerprint.v1',
        actor,
        tenant_id: context.tenant_id ?? null,
        action: `tool.${name}`,
        input,
        task_ref: taskRef,
        is_mutating: definition.is_mutating,
        estimate: definition.cost_estimate,
      },
      deadline_at: new Date(clock.now() + definition.timeout_ms).toISOString(),
      audit_intent: {
        kind: GevEvents.AuditIntent,
        id: intentId,
        ts: clock.iso(),
        actor,
        action: `tool.${name}`,
        target: name,
        params: input,
        task_ref: taskRef,
      },
    });
  } catch (error) {
    return {
      ...makeFailure(
        clock,
        name,
        intentId,
        startTime,
        'LEDGER_UNAVAILABLE',
        normalizeError(error),
        'error'
      ),
      retryable: true,
      retry_after_ms: 250,
    };
  }

  if (reservation.kind === 'replay' || reservation.kind === 'denied') {
    return {
      ...readStoredResult<T>(
        clock,
        name,
        reservation.operation.terminal_result,
        intentId,
        startTime
      ),
      replayed: true,
    };
  }
  if (reservation.kind === 'conflict') {
    return operationFailure(
      clock,
      name,
      intentId,
      startTime,
      'IDEMPOTENCY_CONFLICT',
      reservation.message,
      false
    );
  }
  if (reservation.kind === 'in_progress') {
    return operationFailure(
      clock,
      name,
      intentId,
      startTime,
      'OPERATION_IN_PROGRESS',
      'The original operation is still active',
      true,
      250
    );
  }
  if (reservation.kind === 'in_doubt') {
    return operationFailure(
      clock,
      name,
      intentId,
      startTime,
      'OPERATION_IN_DOUBT',
      'The original operation requires human reconciliation',
      false
    );
  }

  const fingerprint = reservation.operation.request_fingerprint;
  if (definition.is_dangerous) {
    const approvalFailure = await requestApproval(options, name, intentId, startTime);
    if (approvalFailure) {
      return refundReserved(options, name, intentId, fingerprint, approvalFailure, startTime);
    }
  }

  try {
    ledger.startExecution(intentId, fingerprint);
  } catch (error) {
    const expired = normalizeError(error).includes('expired');
    const result = makeFailure(
      clock,
      name,
      intentId,
      startTime,
      expired ? 'RESERVATION_EXPIRED' : 'LEDGER_UNAVAILABLE',
      normalizeError(error),
      expired ? 'blocked' : 'error'
    );
    return refundReserved(options, name, intentId, fingerprint, result, startTime);
  }

  let rawOutput: unknown;
  try {
    rawOutput = await runWithTimeout(
      Promise.resolve(handler(input, { ...context, operation_id: intentId })),
      definition.timeout_ms
    );
  } catch (error) {
    const sourceCode = isHandlerTimeout(error) ? 'HANDLER_TIMEOUT' : 'HANDLER_ERROR';
    const ambiguous = {
      ...makeFailure(
        clock,
        name,
        intentId,
        startTime,
        'OPERATION_IN_DOUBT',
        `${sourceCode}: ${normalizeError(error)}`,
        'error'
      ),
      retryable: false,
    };
    try {
      ledger.markInDoubt({
        operation_id: intentId,
        request_fingerprint: fingerprint,
        reason: ambiguous.error ?? 'Ambiguous handler outcome',
        audit_outcome: toAuditOutcome(clock, ambiguous),
      });
      return ambiguous;
    } catch (ledgerError) {
      return makeFailure(
        clock,
        name,
        intentId,
        startTime,
        'LEDGER_UNAVAILABLE',
        `Handler outcome is ambiguous and could not be durably reconciled: ${normalizeError(ledgerError)}`,
        'error'
      );
    }
  }

  const output = definition.outputSchema.safeParse(rawOutput);
  const terminal = output.success
    ? makeSuccess<T>(clock, name, intentId, startTime, output.data as T)
    : makeFailure(
        clock,
        name,
        intentId,
        startTime,
        'OUTPUT_VALIDATION_FAILED',
        `Output validation error for tool '${name}': ${output.error.message}`,
        'error'
      );
  return settleReserved(
    options,
    name,
    fingerprint,
    terminal,
    definition.cost_estimate.max,
    startTime
  );
}

async function requestApproval(
  options: ReservedToolExecutionOptions,
  name: OperatorToolName,
  intentId: string,
  startTime: number
): Promise<ToolExecutionResult<never> | null> {
  let approval: ApprovalResult;
  const approvalGate = options.approvalGate;
  if (!approvalGate) {
    return makeFailure(
      options.clock,
      name,
      intentId,
      startTime,
      'MISSING_GOVERNANCE_PORT',
      'Execution refused: missing governance ports (ApprovalGate)',
      'error'
    );
  }
  try {
    approval = ApprovalResultSchema.parse(
      await approvalGate.request({
        id: options.idFactory(),
        ts: options.clock.iso(),
        intent_id: intentId,
        scopes: ['flags.write'],
        nonce: options.idFactory(),
        rationale: `Execution of dangerous tool '${name}' requires approval`,
        expires_at: new Date(options.clock.now() + 60_000).toISOString(),
      })
    );
  } catch (error) {
    return makeFailure(
      options.clock,
      name,
      intentId,
      startTime,
      'APPROVAL_UNAVAILABLE',
      `Approval governance failed for tool '${name}': ${normalizeError(error)}`,
      'error'
    );
  }
  return approval.decision === 'approved'
    ? null
    : makeFailure(
        options.clock,
        name,
        intentId,
        startTime,
        'APPROVAL_DENIED',
        `Tool execution rejected by ApprovalGate: decision was '${approval.decision}'`,
        'blocked'
      );
}

function refundReserved<T>(
  options: ReservedToolExecutionOptions,
  name: OperatorToolName,
  intentId: string,
  fingerprint: string,
  terminal: ToolExecutionResult<T>,
  startTime: number
): ToolExecutionResult<T> {
  try {
    const operation = options.ledger.refund({
      operation_id: intentId,
      request_fingerprint: fingerprint,
      actual_microusd: 0,
      terminal_result: terminal,
      audit_outcome: toAuditOutcome(options.clock, terminal),
      evidence: null,
    });
    return readStoredResult<T>(options.clock, name, operation.terminal_result, intentId, startTime);
  } catch (error) {
    return makeFailure(
      options.clock,
      name,
      intentId,
      startTime,
      'LEDGER_UNAVAILABLE',
      `Reservation refund failed closed: ${normalizeError(error)}`,
      'error'
    );
  }
}

function settleReserved<T>(
  options: ReservedToolExecutionOptions,
  name: OperatorToolName,
  fingerprint: string,
  terminal: ToolExecutionResult<T>,
  actualUsd: number,
  startTime: number
): ToolExecutionResult<T> {
  try {
    const operation = options.ledger.settle({
      operation_id: terminal.intent_id,
      request_fingerprint: fingerprint,
      actual_microusd: toMicrousd(actualUsd),
      terminal_result: terminal,
      audit_outcome: toAuditOutcome(options.clock, terminal),
    });
    return readStoredResult<T>(
      options.clock,
      name,
      operation.terminal_result,
      terminal.intent_id,
      startTime
    );
  } catch (error) {
    const ambiguous = {
      ...makeFailure(
        options.clock,
        name,
        terminal.intent_id,
        startTime,
        'OPERATION_IN_DOUBT',
        `Settlement could not be confirmed: ${normalizeError(error)}`,
        'error'
      ),
      retryable: false,
    };
    try {
      options.ledger.markInDoubt({
        operation_id: terminal.intent_id,
        request_fingerprint: fingerprint,
        reason: ambiguous.error ?? 'Settlement unavailable',
        audit_outcome: toAuditOutcome(options.clock, ambiguous),
      });
      return ambiguous;
    } catch (markError) {
      return makeFailure(
        options.clock,
        name,
        terminal.intent_id,
        startTime,
        'LEDGER_UNAVAILABLE',
        `Action may have completed; settlement and in-doubt state are unavailable: ${normalizeError(markError)}`,
        'error'
      );
    }
  }
}

function operationFailure(
  clock: SimClock,
  name: string,
  intentId: string,
  startTime: number,
  code: ToolExecutionFailureCode,
  error: string,
  retryable: boolean,
  retryAfterMs?: number
): ToolExecutionResult<never> {
  return {
    ...makeFailure(clock, name, intentId, startTime, code, error, 'blocked'),
    retryable,
    ...(retryAfterMs === undefined ? {} : { retry_after_ms: retryAfterMs }),
  };
}
