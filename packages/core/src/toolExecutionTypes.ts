import { type AuditOutcome, GevEvents } from '@gev/contracts';
import type { SimClock } from './clock.js';

export const MICRO_USD_PER_USD = 1_000_000;

export interface ToolExecutionContext {
  actor?: 'ai' | 'human' | 'system';
  task_ref?: string;
  tenant_id?: string | null;
  operation_id?: string;
}

export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ToolExecutionContext
) => Promise<TOutput> | TOutput;

export type ToolExecutionFailureCode =
  | 'UNKNOWN_TOOL'
  | 'TOOL_UNAVAILABLE'
  | 'INPUT_VALIDATION_FAILED'
  | 'MISSING_GOVERNANCE_PORT'
  | 'MISSING_HANDLER'
  | 'AUDIT_INTENT_FAILED'
  | 'AUDIT_OUTCOME_FAILED'
  | 'GOVERNANCE_UNAVAILABLE'
  | 'LEDGER_UNAVAILABLE'
  | 'BUDGET_DENIED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'OPERATION_IN_PROGRESS'
  | 'OPERATION_IN_DOUBT'
  | 'OPERATION_RECONCILED'
  | 'RESERVATION_EXPIRED'
  | 'APPROVAL_UNAVAILABLE'
  | 'APPROVAL_DENIED'
  | 'HANDLER_ERROR'
  | 'HANDLER_TIMEOUT'
  | 'OUTPUT_VALIDATION_FAILED'
  | 'OUTPUT_TOO_LARGE';

export interface ToolExecutionResult<T = unknown> {
  success: boolean;
  status: 'ok' | 'error' | 'blocked';
  tool: string;
  intent_id: string;
  result?: T;
  error?: string;
  code?: ToolExecutionFailureCode;
  duration_ms: number;
  blocked?: boolean;
  replayed?: boolean;
  retryable?: boolean;
  retry_after_ms?: number;
}

export function durationSince(clock: SimClock, startTime: number): number {
  return Math.max(0, Math.floor(clock.now() - startTime));
}

export function makeSuccess<T>(
  clock: SimClock,
  name: string,
  intentId: string,
  startTime: number,
  result: T
): ToolExecutionResult<T> {
  return {
    success: true,
    status: 'ok',
    tool: name,
    intent_id: intentId,
    result,
    duration_ms: durationSince(clock, startTime),
  };
}

export function makeFailure(
  clock: SimClock,
  name: string,
  intentId: string,
  startTime: number,
  code: ToolExecutionFailureCode,
  error: string,
  status: 'error' | 'blocked'
): ToolExecutionResult<never> {
  return {
    success: false,
    status,
    tool: name,
    intent_id: intentId,
    error,
    code,
    duration_ms: durationSince(clock, startTime),
    ...(status === 'blocked' ? { blocked: true } : {}),
  };
}

export function toAuditOutcome(
  clock: SimClock,
  result: ToolExecutionResult<unknown>
): AuditOutcome {
  return {
    kind: GevEvents.AuditOutcome,
    intent_id: result.intent_id,
    ts: clock.iso(),
    status: result.status,
    ...(result.success ? { result: result.result } : {}),
    ...(!result.success && result.error ? { error: result.error } : {}),
    duration_ms: result.duration_ms,
  };
}

export function readStoredResult<T>(
  clock: SimClock,
  name: string,
  stored: unknown,
  intentId: string,
  startTime: number
): ToolExecutionResult<T> {
  if (!isStoredResult(stored)) {
    return makeFailure(
      clock,
      name,
      intentId,
      startTime,
      'LEDGER_UNAVAILABLE',
      'Stored terminal result is missing or invalid',
      'error'
    );
  }
  return stored as ToolExecutionResult<T>;
}

export function toMicrousd(value: number): number {
  const amount = Math.ceil(value * MICRO_USD_PER_USD);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Tool cost is outside the supported micro-USD range');
  }
  return amount;
}

export function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class ToolTimeoutError extends Error {}

export async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ToolTimeoutError(`Handler exceeded ${timeoutMs} ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function isHandlerTimeout(error: unknown): boolean {
  return error instanceof ToolTimeoutError;
}

function isStoredResult(value: unknown): value is ToolExecutionResult<unknown> {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<ToolExecutionResult<unknown>>;
  return (
    typeof result.success === 'boolean' &&
    (result.status === 'ok' || result.status === 'error' || result.status === 'blocked') &&
    typeof result.tool === 'string' &&
    typeof result.intent_id === 'string' &&
    typeof result.duration_ms === 'number'
  );
}
