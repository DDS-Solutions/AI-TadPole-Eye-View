import {
  type ApprovalGate,
  type ApprovalResult,
  ApprovalResult as ApprovalResultSchema,
  type AuditSink,
  type BudgetGovernor,
  BudgetState as BudgetStateSchema,
  GevEvents,
  OPERATOR_TOOLS,
  type OperatorToolName,
  Verdict as VerdictSchema,
  isOperatorToolName,
} from '@gev/contracts';
import type { SimClock } from './clock.js';
import { SystemClock } from './clock.js';

function generateUuid(): string {
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export interface ToolExecutionContext {
  actor?: 'ai' | 'human' | 'system';
  task_ref?: string;
}

export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ToolExecutionContext
) => Promise<TOutput> | TOutput;

export interface GovernedToolExecutorOptions {
  auditSink?: AuditSink;
  approvalGate?: ApprovalGate;
  budgetGovernor?: BudgetGovernor;
  clock?: SimClock;
  allowedTools?: readonly OperatorToolName[];
  idFactory?: () => string;
}

export type ToolExecutionFailureCode =
  | 'UNKNOWN_TOOL'
  | 'TOOL_UNAVAILABLE'
  | 'INPUT_VALIDATION_FAILED'
  | 'MISSING_GOVERNANCE_PORT'
  | 'MISSING_HANDLER'
  | 'AUDIT_INTENT_FAILED'
  | 'GOVERNANCE_UNAVAILABLE'
  | 'BUDGET_DENIED'
  | 'APPROVAL_UNAVAILABLE'
  | 'APPROVAL_DENIED'
  | 'HANDLER_ERROR'
  | 'OUTPUT_VALIDATION_FAILED'
  | 'AUDIT_OUTCOME_FAILED';

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
}

/**
 * The single governed operator-tool lifecycle shared by UI, CLI, and MCP consumers.
 * Invalid/unavailable calls fail before an audit intent. Once intent storage succeeds,
 * exactly one outcome is attempted after every blocked, failed, or successful lifecycle.
 */
export class GovernedToolExecutor {
  private readonly handlers = new Map<OperatorToolName, ToolHandler>();
  private readonly auditSink?: AuditSink;
  private readonly approvalGate?: ApprovalGate;
  private readonly budgetGovernor?: BudgetGovernor;
  private readonly clock: SimClock;
  private readonly allowedTools?: ReadonlySet<OperatorToolName>;
  private readonly idFactory: () => string;

  constructor(options: GovernedToolExecutorOptions = {}) {
    this.auditSink = options.auditSink;
    this.approvalGate = options.approvalGate;
    this.budgetGovernor = options.budgetGovernor;
    this.clock = options.clock ?? new SystemClock();
    this.allowedTools = options.allowedTools ? new Set(options.allowedTools) : undefined;
    this.idFactory = options.idFactory ?? generateUuid;
  }

  register<TName extends OperatorToolName>(
    name: TName,
    handler: ToolHandler<
      (typeof OPERATOR_TOOLS)[TName]['inputSchema']['_output'],
      (typeof OPERATOR_TOOLS)[TName]['outputSchema']['_output']
    >
  ): this {
    if (this.allowedTools && !this.allowedTools.has(name)) {
      throw new Error(`Cannot register tool '${name}' outside this consumer's capability set`);
    }
    this.handlers.set(name, handler as ToolHandler);
    return this;
  }

  hasHandler(name: string): boolean {
    return isOperatorToolName(name) && this.handlers.has(name);
  }

  async execute<T = unknown>(
    name: string,
    rawInput: unknown,
    context: ToolExecutionContext = {}
  ): Promise<ToolExecutionResult<T>> {
    const startTime = this.clock.now();
    const intentId = this.idFactory();

    if (!isOperatorToolName(name)) {
      return this.preflightFailure(
        name,
        intentId,
        startTime,
        'UNKNOWN_TOOL',
        `Unknown tool: '${name}' is not in the contract registry`
      );
    }
    if (this.allowedTools && !this.allowedTools.has(name)) {
      return this.preflightFailure(
        name,
        intentId,
        startTime,
        'TOOL_UNAVAILABLE',
        `Tool '${name}' is unavailable for this consumer`
      );
    }

    const definition = OPERATOR_TOOLS[name];
    const input = definition.inputSchema.safeParse(rawInput);
    if (!input.success) {
      return this.preflightFailure(
        name,
        intentId,
        startTime,
        'INPUT_VALIDATION_FAILED',
        `Validation error for tool '${name}': ${input.error.message}`
      );
    }

    const auditSink = this.auditSink;
    const approvalGate = this.approvalGate;
    const budgetGovernor = this.budgetGovernor;
    if (!auditSink || !approvalGate || !budgetGovernor) {
      const missing = [
        !auditSink ? 'AuditSink' : undefined,
        !approvalGate ? 'ApprovalGate' : undefined,
        !budgetGovernor ? 'BudgetGovernor' : undefined,
      ].filter((port): port is string => port !== undefined);
      return this.preflightFailure(
        name,
        intentId,
        startTime,
        'MISSING_GOVERNANCE_PORT',
        `Execution refused: missing governance ports (${missing.join(', ')})`
      );
    }

    const handler = this.handlers.get(name);
    if (!handler) {
      return this.preflightFailure(
        name,
        intentId,
        startTime,
        'MISSING_HANDLER',
        `No handler registered for tool '${name}'`
      );
    }

    const actor = context.actor ?? 'ai';
    const taskRef = context.task_ref ?? 'tool-execution';
    try {
      auditSink.intent({
        kind: GevEvents.AuditIntent,
        id: intentId,
        ts: this.clock.iso(),
        actor,
        action: `tool.${name}`,
        target: name,
        params: input.data,
        task_ref: taskRef,
      });
    } catch (error: unknown) {
      return this.preflightFailure(
        name,
        intentId,
        startTime,
        'AUDIT_INTENT_FAILED',
        `Audit intent failed for tool '${name}': ${normalizeError(error)}`
      );
    }

    const finish = (
      status: 'ok' | 'error' | 'blocked',
      options: { result?: unknown; error?: string; code?: ToolExecutionFailureCode } = {}
    ): ToolExecutionResult<T> => {
      const durationMs = this.durationSince(startTime);
      try {
        auditSink.outcome({
          kind: GevEvents.AuditOutcome,
          intent_id: intentId,
          ts: this.clock.iso(),
          status,
          result: options.result,
          error: options.error,
          duration_ms: durationMs,
        });
      } catch (error: unknown) {
        return {
          success: false,
          status: 'error',
          tool: name,
          intent_id: intentId,
          error: `Audit outcome failed for tool '${name}': ${normalizeError(error)}`,
          code: 'AUDIT_OUTCOME_FAILED',
          duration_ms: this.durationSince(startTime),
          ...(status === 'blocked' ? { blocked: true } : {}),
        };
      }

      if (status === 'ok') {
        return {
          success: true,
          status,
          tool: name,
          intent_id: intentId,
          result: options.result as T,
          duration_ms: durationMs,
        };
      }
      return {
        success: false,
        status,
        tool: name,
        intent_id: intentId,
        error: options.error,
        code: options.code,
        duration_ms: durationMs,
        ...(status === 'blocked' ? { blocked: true } : {}),
      };
    };

    try {
      if (definition.is_mutating) {
        const verdict = VerdictSchema.parse(
          budgetGovernor.check({
            action: `tool.${name}`,
            // Reservation and settlement belong to Task 5.1.4. A zero estimate still
            // performs the authoritative durable STASIS check without claiming M3.
            estimate: { currency: 'usd', min: 0, max: 0 },
          })
        );
        if (!verdict.allowed) {
          return finish('blocked', {
            code: 'BUDGET_DENIED',
            error: `Execution blocked by BudgetGovernor: ${verdict.message} (${verdict.reason})`,
          });
        }
      } else {
        // Status, diagnostics, and audit reads remain available during STASIS, but the
        // durable state read must still succeed and validate before their handlers run.
        BudgetStateSchema.parse(budgetGovernor.state());
      }
    } catch (error: unknown) {
      return finish('error', {
        code: 'GOVERNANCE_UNAVAILABLE',
        error: `Budget governance failed for tool '${name}': ${normalizeError(error)}`,
      });
    }

    if (definition.is_dangerous) {
      let approval: ApprovalResult;
      try {
        approval = ApprovalResultSchema.parse(
          await approvalGate.request({
            id: this.idFactory(),
            ts: this.clock.iso(),
            intent_id: intentId,
            scopes: ['flags.write'],
            nonce: this.idFactory(),
            rationale: `Execution of dangerous tool '${name}' requires approval`,
            expires_at: new Date(this.clock.now() + 60_000).toISOString(),
          })
        );
      } catch (error: unknown) {
        return finish('error', {
          code: 'APPROVAL_UNAVAILABLE',
          error: `Approval governance failed for tool '${name}': ${normalizeError(error)}`,
        });
      }
      if (approval.decision !== 'approved') {
        return finish('blocked', {
          code: 'APPROVAL_DENIED',
          error: `Tool execution rejected by ApprovalGate: decision was '${approval.decision}'`,
        });
      }
    }

    let rawOutput: unknown;
    try {
      rawOutput = await handler(input.data, context);
    } catch (error: unknown) {
      return finish('error', {
        code: 'HANDLER_ERROR',
        error: `Handler failed for tool '${name}': ${normalizeError(error)}`,
      });
    }

    const output = definition.outputSchema.safeParse(rawOutput);
    if (!output.success) {
      return finish('error', {
        code: 'OUTPUT_VALIDATION_FAILED',
        error: `Output validation error for tool '${name}': ${output.error.message}`,
      });
    }

    return finish('ok', { result: output.data });
  }

  private preflightFailure(
    tool: string,
    intentId: string,
    startTime: number,
    code: ToolExecutionFailureCode,
    error: string
  ): ToolExecutionResult<never> {
    return {
      success: false,
      status: 'error',
      tool,
      intent_id: intentId,
      error,
      code,
      duration_ms: this.durationSince(startTime),
    };
  }

  private durationSince(startTime: number): number {
    return Math.max(0, Math.floor(this.clock.now() - startTime));
  }
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
