import { GevEvents, M3_FINGERPRINT_VERSION, M3_LEDGER_CONTRACT_VERSION } from '@gev/contracts';
import { createGovernanceRuntimeContext } from '@gev/governance';

const dbPath = process.argv[2];
const operationId = process.argv[3];
if (!dbPath || !operationId) {
  throw new Error('Usage: ledgerProcess.ts <dbPath> <operation-id>');
}

const runtime = createGovernanceRuntimeContext({ dbPath, capUsd: 1 });
try {
  const now = runtime.clock.iso();
  const result = runtime.budgetLedger.reserve({
    operation_id: operationId,
    fingerprint_components: {
      contract_version: M3_LEDGER_CONTRACT_VERSION,
      fingerprint_version: M3_FINGERPRINT_VERSION,
      actor: 'system',
      tenant_id: null,
      action: 'tool.concurrent_test',
      input: { stable: true },
      task_ref: 'two-process-ledger-test',
      is_mutating: true,
      estimate: { currency: 'usd', min: 0, max: 0.25 },
    },
    deadline_at: new Date(runtime.clock.now() + 30_000).toISOString(),
    audit_intent: {
      kind: GevEvents.AuditIntent,
      id: operationId,
      ts: now,
      actor: 'system',
      action: 'tool.concurrent_test',
      target: 'concurrent_test',
      params: { stable: true },
      task_ref: 'two-process-ledger-test',
    },
  });
  process.stdout.write(result.kind);
} finally {
  runtime.close();
}
