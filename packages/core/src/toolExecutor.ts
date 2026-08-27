import {
  type ApprovalGate,
  type AuditSink,
  type BudgetGovernor,
  GevEvents,
  OPERATOR_TOOLS,
  type OperatorToolName,
} from '@gev/contracts';

function generateUuid(): string {
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface ToolExecutionContext {
  actor?: 'ai' | 'human' | 'system';
  task_ref?: string;
}

export type ToolHandler<TIn = unknown, TOut = unknown> = (
  input: TIn,
  context?: ToolExecutionContext
) => Promise<TOut> | TOut;

export interface GovernedToolExecutorOptions {
  auditSink?: AuditSink;
  approvalGate?: ApprovalGate;
  budgetGovernor?: BudgetGovernor;
}

export interface ToolExecutionResult<T = unknown> {
  success: boolean;
  tool: string;
  intent_id: string;
  result?: T;
  error?: string;
  duration_ms: number;
  blocked?: boolean;
}

/**
 * Governed Tool Execution Engine.
 * Enforces pre/post AuditSink logging (PLAN.md §2 rule 1, §6), STASIS compliance,
 * and ApprovalGate checks for dangerous tools.
 */
export class GovernedToolExecutor {
  private handlers = new Map<string, ToolHandler>();
  private auditSink?: AuditSink;
  private approvalGate?: ApprovalGate;
  private budgetGovernor?: BudgetGovernor;

  constructor(options: GovernedToolExecutorOptions = {}) {
    this.auditSink = options.auditSink;
    this.approvalGate = options.approvalGate;
    this.budgetGovernor = options.budgetGovernor;
  }

  /**
   * Register an executable implementation for a specific tool definition.
   */
  register<TName extends OperatorToolName>(
    name: TName,
    handler: ToolHandler<
      (typeof OPERATOR_TOOLS)[TName]['inputSchema']['_output'],
      (typeof OPERATOR_TOOLS)[TName]['outputSchema']['_output']
    >
  ): this {
    this.handlers.set(name, handler as ToolHandler);
    return this;
  }

  /**
   * Check if a handler is registered for a tool.
   */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Execute a tool with full governance interceptors:
   * 1. Schema validation
   * 2. STASIS & Budget Governor validation
   * 3. Pre-execution AuditIntent WAL entry
   * 4. ApprovalGate check for dangerous/mutating tools
   * 5. Execution
   * 6. Post-execution AuditOutcome WAL entry
   */
  async execute<T = unknown>(
    name: string,
    rawInput: unknown,
    context: ToolExecutionContext = {}
  ): Promise<ToolExecutionResult<T>> {
    const start = performance.now();
    const intentId = generateUuid();
    const actor = context.actor ?? 'ai';
    const taskRef = context.task_ref ?? 'phase3-tool-execution';

    const toolDef = OPERATOR_TOOLS[name as OperatorToolName];
    if (!toolDef) {
      const err = `Unknown tool: '${name}' is not in the contract registry`;
      this.logOutcome(intentId, 'error', start, undefined, err, taskRef, actor, name);
      return {
        success: false,
        tool: name,
        intent_id: intentId,
        error: err,
        duration_ms: performance.now() - start,
      };
    }

    // 1. Validate Input Schema
    let parsedInput: unknown;
    try {
      parsedInput = toolDef.inputSchema.parse(rawInput);
    } catch (valErr: unknown) {
      const err = `Validation error for tool '${name}': ${valErr instanceof Error ? valErr.message : String(valErr)}`;
      this.logOutcome(intentId, 'error', start, undefined, err, taskRef, actor, name);
      return {
        success: false,
        tool: name,
        intent_id: intentId,
        error: err,
        duration_ms: performance.now() - start,
      };
    }

    // 2. Check STASIS and Budget Governor
    if (this.budgetGovernor) {
      const bState = this.budgetGovernor.state();
      if (bState.stasis_active) {
        const err = `Execution blocked: STASIS active (${bState.last_trip?.code || 'budget breach'})`;
        this.logOutcome(intentId, 'blocked', start, undefined, err, taskRef, actor, name);
        return {
          success: false,
          tool: name,
          intent_id: intentId,
          error: err,
          blocked: true,
          duration_ms: performance.now() - start,
        };
      }

      const verdict = this.budgetGovernor.check({
        action: `tool.${name}`,
        estimate: { currency: 'usd', min: 0.0001, max: 0.001 },
      });
      if (!verdict.allowed) {
        const err = `Execution denied by BudgetGovernor: ${verdict.message} (${verdict.reason})`;
        this.logOutcome(intentId, 'blocked', start, undefined, err, taskRef, actor, name);
        return {
          success: false,
          tool: name,
          intent_id: intentId,
          error: err,
          blocked: true,
          duration_ms: performance.now() - start,
        };
      }
    }

    // 3. Pre-execution AuditIntent
    if (this.auditSink) {
      this.auditSink.intent({
        kind: GevEvents.AuditIntent,
        id: intentId,
        ts: new Date().toISOString(),
        actor,
        action: `tool.${name}`,
        target: 'console',
        params: parsedInput,
        task_ref: taskRef,
      });
    }

    // 4. Check ApprovalGate if dangerous
    if (toolDef.is_dangerous && this.approvalGate) {
      const scopes: (
        | 'flags.write'
        | 'repo.write'
        | 'deploy.preview'
        | 'deploy.prod'
        | 'spend.external'
        | 'data.export'
      )[] = ['flags.write'];

      const approval = await this.approvalGate.request({
        id: generateUuid(),
        ts: new Date().toISOString(),
        intent_id: intentId,
        scopes,
        rationale: `Execution of dangerous tool '${name}' requires approval`,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      });

      if (approval.decision !== 'approved') {
        const err = `Tool execution rejected by ApprovalGate: decision was '${approval.decision}'`;
        this.logOutcome(intentId, 'blocked', start, undefined, err, taskRef, actor, name);
        return {
          success: false,
          tool: name,
          intent_id: intentId,
          error: err,
          blocked: true,
          duration_ms: performance.now() - start,
        };
      }
    }

    // 5. Execute Handler (Fail closed if no handler registered)
    const handler = this.handlers.get(name);
    if (!handler) {
      const err = `No handler registered for tool '${name}'`;
      this.logOutcome(intentId, 'error', start, undefined, err, taskRef, actor, name);
      return {
        success: false,
        tool: name,
        intent_id: intentId,
        error: err,
        duration_ms: performance.now() - start,
      };
    }

    try {
      const output = await handler(parsedInput, context);
      const validatedOutput = toolDef.outputSchema.safeParse(output);
      if (!validatedOutput.success) {
        const err = `Output validation error for tool '${name}': ${validatedOutput.error.message}`;
        this.logOutcome(intentId, 'error', start, undefined, err, taskRef, actor, name);
        return {
          success: false,
          tool: name,
          intent_id: intentId,
          error: err,
          duration_ms: performance.now() - start,
        };
      }

      const finalResult = validatedOutput.data;

      // Settle spend with BudgetGovernor on successful execution
      if (this.budgetGovernor && typeof this.budgetGovernor.recordSpend === 'function') {
        this.budgetGovernor.recordSpend(0.0005);
      }

      this.logOutcome(intentId, 'ok', start, finalResult, undefined, taskRef, actor, name);
      return {
        success: true,
        tool: name,
        intent_id: intentId,
        result: finalResult as T,
        duration_ms: performance.now() - start,
      };
    } catch (execErr: unknown) {
      const err = execErr instanceof Error ? execErr.message : String(execErr);
      this.logOutcome(intentId, 'error', start, undefined, err, taskRef, actor, name);
      return {
        success: false,
        tool: name,
        intent_id: intentId,
        error: err,
        duration_ms: performance.now() - start,
      };
    }
  }

  private logOutcome(
    intentId: string,
    status: 'ok' | 'error' | 'blocked',
    startTime: number,
    result?: unknown,
    error?: string,
    _taskRef = 'phase3-tool-execution',
    _actor: 'ai' | 'human' | 'system' = 'ai',
    _toolName = 'tool'
  ) {
    if (!this.auditSink) return;
    this.auditSink.outcome({
      kind: GevEvents.AuditOutcome,
      intent_id: intentId,
      ts: new Date().toISOString(),
      status,
      result,
      error,
      duration_ms: performance.now() - startTime,
    });
  }
}
