import {
  type ApprovalGate,
  type AuditSink,
  type BudgetGovernor,
  type BudgetLedger,
  BudgetState as BudgetStateSchema,
  GevEvents,
  OPERATOR_TOOLS,
  type OperatorToolName,
  isOperatorToolName,
} from '@gev/contracts';
import type { SimClock } from './clock.js';
import { SystemClock } from './clock.js';
import { executeReservedTool } from './reservedToolExecution.js';
import {
  type ToolExecutionContext,
  type ToolExecutionFailureCode,
  type ToolExecutionResult,
  type ToolHandler,
  isHandlerTimeout,
  makeFailure,
  makeSuccess,
  normalizeError,
  runWithTimeout,
  toAuditOutcome,
} from './toolExecutionTypes.js';

export type {
  ToolExecutionContext,
  ToolExecutionFailureCode,
  ToolExecutionResult,
  ToolHandler,
} from './toolExecutionTypes.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export interface GovernedToolExecutorOptions {
  auditSink?: AuditSink;
  approvalGate?: ApprovalGate;
  budgetGovernor?: BudgetGovernor;
  budgetLedger?: BudgetLedger;
  clock?: SimClock;
  allowedTools?: readonly OperatorToolName[];
  idFactory?: () => string;
}

/** Shared, governed lifecycle used by every operator-tool transport. */
export class GovernedToolExecutor {
  private readonly handlers = new Map<OperatorToolName, ToolHandler>();
  private readonly auditSink?: AuditSink;
  private readonly approvalGate?: ApprovalGate;
  private readonly budgetGovernor?: BudgetGovernor;
  private readonly budgetLedger?: BudgetLedger;
  private readonly clock: SimClock;
  private readonly allowedTools?: ReadonlySet<OperatorToolName>;
  private readonly idFactory: () => string;

  constructor(options: GovernedToolExecutorOptions = {}) {
    this.auditSink = options.auditSink;
    this.approvalGate = options.approvalGate;
    this.budgetGovernor = options.budgetGovernor;
    this.budgetLedger = options.budgetLedger;
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
    const intentId = context.operation_id ?? this.idFactory();
    if (!UUID_PATTERN.test(intentId)) {
      return this.preflightFailure(
        name,
        intentId,
        startTime,
        'INPUT_VALIDATION_FAILED',
        'operation_id must be a UUID and must be reused after every non-success response'
      );
    }
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

    const missing = this.missingPorts(definition.requires_reservation, definition.is_dangerous);
    if (missing.length > 0) {
      return this.preflightFailure(
        name,
        intentId,
        startTime,
        'MISSING_GOVERNANCE_PORT',
        `Execution refused: missing governance ports (${missing.join(', ')})`
      );
    }

    if (definition.requires_reservation) {
      const ledger = this.budgetLedger;
      if (!ledger) {
        return this.preflightFailure(
          name,
          intentId,
          startTime,
          'MISSING_GOVERNANCE_PORT',
          'Execution refused: missing governance ports (BudgetLedger)'
        );
      }
      return executeReservedTool<T>(
        {
          clock: this.clock,
          ledger,
          approvalGate: this.approvalGate,
          idFactory: this.idFactory,
        },
        name,
        input.data,
        handler,
        context,
        intentId,
        startTime
      );
    }
    return this.executeUnreserved<T>(name, input.data, handler, context, intentId, startTime);
  }

  private missingPorts(requiresReservation: boolean, isDangerous: boolean): string[] {
    return [
      !this.auditSink ? 'AuditSink' : undefined,
      !this.budgetGovernor ? 'BudgetGovernor' : undefined,
      requiresReservation && !this.budgetLedger ? 'BudgetLedger' : undefined,
      isDangerous && !this.approvalGate ? 'ApprovalGate' : undefined,
    ].filter((port): port is string => port !== undefined);
  }

  private async executeUnreserved<T>(
    name: OperatorToolName,
    input: unknown,
    handler: ToolHandler,
    context: ToolExecutionContext,
    intentId: string,
    startTime: number
  ): Promise<ToolExecutionResult<T>> {
    const auditSink = this.auditSink;
    const budgetGovernor = this.budgetGovernor;
    if (!auditSink || !budgetGovernor) {
      return this.preflightFailure(
        name,
        intentId,
        startTime,
        'MISSING_GOVERNANCE_PORT',
        'Execution refused: missing governance ports (AuditSink, BudgetGovernor)'
      );
    }
    try {
      auditSink.intent({
        kind: GevEvents.AuditIntent,
        id: intentId,
        ts: this.clock.iso(),
        actor: context.actor ?? 'ai',
        action: `tool.${name}`,
        target: name,
        params: input,
        task_ref: context.task_ref ?? 'tool-execution',
      });
    } catch (error) {
      return this.preflightFailure(
        name,
        intentId,
        startTime,
        'AUDIT_INTENT_FAILED',
        `Audit intent failed for tool '${name}': ${normalizeError(error)}`
      );
    }

    try {
      BudgetStateSchema.parse(budgetGovernor.state());
    } catch (error) {
      return this.finishUnreserved(
        auditSink,
        makeFailure(
          this.clock,
          name,
          intentId,
          startTime,
          'GOVERNANCE_UNAVAILABLE',
          `Budget governance failed for tool '${name}': ${normalizeError(error)}`,
          'error'
        )
      );
    }

    let rawOutput: unknown;
    try {
      rawOutput = await runWithTimeout(
        Promise.resolve(handler(input, { ...context, operation_id: intentId })),
        OPERATOR_TOOLS[name].timeout_ms
      );
    } catch (error) {
      return this.finishUnreserved(
        auditSink,
        makeFailure(
          this.clock,
          name,
          intentId,
          startTime,
          isHandlerTimeout(error) ? 'HANDLER_TIMEOUT' : 'HANDLER_ERROR',
          `Handler failed for tool '${name}': ${normalizeError(error)}`,
          'error'
        )
      );
    }

    const output = OPERATOR_TOOLS[name].outputSchema.safeParse(rawOutput);
    const result = output.success
      ? makeSuccess<T>(this.clock, name, intentId, startTime, output.data as T)
      : makeFailure(
          this.clock,
          name,
          intentId,
          startTime,
          'OUTPUT_VALIDATION_FAILED',
          `Output validation error for tool '${name}': ${output.error.message}`,
          'error'
        );
    return this.finishUnreserved(auditSink, result);
  }

  private finishUnreserved<T>(
    auditSink: AuditSink,
    result: ToolExecutionResult<T>
  ): ToolExecutionResult<T> {
    try {
      auditSink.outcome(toAuditOutcome(this.clock, result));
      return result;
    } catch (error) {
      return {
        ...makeFailure(
          this.clock,
          result.tool,
          result.intent_id,
          this.clock.now() - result.duration_ms,
          'AUDIT_OUTCOME_FAILED',
          `Audit outcome failed for tool '${result.tool}': ${normalizeError(error)}`,
          'error'
        ),
        ...(result.status === 'blocked' ? { blocked: true } : {}),
      };
    }
  }

  private preflightFailure(
    tool: string,
    intentId: string,
    startTime: number,
    code: ToolExecutionFailureCode,
    error: string
  ): ToolExecutionResult<never> {
    return makeFailure(this.clock, tool, intentId, startTime, code, error, 'error');
  }
}
