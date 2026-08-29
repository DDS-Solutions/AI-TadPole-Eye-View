import crypto from 'node:crypto';
import {
  GevEvents,
  type LedgerEvidence,
  type LedgerReconciliationInput,
  LedgerReconciliationInputSchema,
  LedgerReconciliationResponseSchema,
} from '@gev/contracts';
import { SystemClock } from '@gev/core';
import { createGovernanceRuntimeContext } from '@gev/governance';
import pc from 'picocolors';

export interface BudgetReconcileOptions {
  settledUsd?: number;
  refunded?: boolean;
  summary: string;
  evidenceKind?: LedgerEvidence['kind'];
  reference?: string;
  serverUrl?: string;
  governanceDbPath?: string;
}

function isLoopbackServerUrl(serverUrl: string): boolean {
  try {
    const hostname = new URL(serverUrl).hostname;
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
  } catch {
    return false;
  }
}

function reconciliationInput(
  operationId: string,
  options: BudgetReconcileOptions
): LedgerReconciliationInput {
  const hasSettlement = options.settledUsd !== undefined;
  const hasRefund = options.refunded === true;
  if (hasSettlement === hasRefund) {
    throw new Error('Choose exactly one of --settled-usd or --refunded');
  }
  return LedgerReconciliationInputSchema.parse({
    operation_id: operationId,
    resolution: options.refunded ? 'refunded' : 'settled',
    actual_usd: options.refunded ? null : options.settledUsd,
    evidence: {
      kind: options.evidenceKind ?? 'operator_attestation',
      reference: options.reference ?? null,
      summary: options.summary,
    },
  });
}

export async function runBudgetReconcile(
  operationId: string,
  options: BudgetReconcileOptions
): Promise<void> {
  const input = reconciliationInput(operationId, options);
  const serverUrl = options.serverUrl ?? 'http://localhost:3000';
  let serverResponse: Response | undefined;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    const opsToken = process.env.GEV_OPS_TOKEN ?? '';
    try {
      serverResponse = await fetch(`${serverUrl}/ops/budget/reconcile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(opsToken ? { Authorization: `Bearer ${opsToken}` } : {}),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (!isLoopbackServerUrl(serverUrl)) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot verify remote ledger state; refusing local fallback: ${detail}`);
    }
    console.log(pc.dim('Server offline. Using local durable governance state.\n'));
  }

  if (serverResponse) {
    if (!serverResponse.ok) {
      const detail = (await serverResponse.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        `Server refused ledger reconciliation (${serverResponse.status}): ${detail.error ?? 'Unknown'}`
      );
    }
    const response = LedgerReconciliationResponseSchema.parse(await serverResponse.json());
    printResult(response.operation_id, response.state, response.settled_microusd);
    return;
  }

  const clock = new SystemClock();
  const governanceContext = createGovernanceRuntimeContext({
    clock,
    dbPath: options.governanceDbPath,
  });
  try {
    if (!governanceContext.authority().authoritative) {
      throw new Error('Offline reconciliation requires durable shared SQLite governance state');
    }
    const reconciliationIntentId = crypto.randomUUID();
    const operation = governanceContext.budgetLedger.reconcile(
      {
        ...input,
        audit_intent: {
          kind: GevEvents.AuditIntent,
          id: reconciliationIntentId,
          ts: clock.iso(),
          actor: 'human',
          action: 'governance.budget.reconcile',
          target: operationId,
          params: input,
          task_ref: 'human-ledger-reconciliation',
        },
      },
      'human'
    );
    printResult(operation.operation_id, operation.state, operation.settled_microusd);
  } finally {
    governanceContext.close();
  }
}

function printResult(operationId: string, state: string, settledMicrousd: number): void {
  console.log(pc.bold(pc.green('\n✔ AMBIGUOUS OPERATION RECONCILED')));
  console.log(` Operation: ${operationId}`);
  console.log(` State:     ${state}`);
  console.log(` Settled:   $${(settledMicrousd / 1_000_000).toFixed(6)} USD`);
  console.log(pc.dim(' STASIS remains active until a separate human resume.\n'));
}
