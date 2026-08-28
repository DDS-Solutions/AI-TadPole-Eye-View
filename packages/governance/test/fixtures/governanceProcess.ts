import { openGovernanceDatabase, withImmediateTransaction } from '../../src/governanceDb.ts';

const operation = process.argv[2];
const dbPath = process.argv[3];

if (!operation || !dbPath) {
  throw new Error('Usage: governanceProcess.ts <operation> <dbPath> [arguments]');
}

const { db } = openGovernanceDatabase({ dbPath });

if (operation === 'spend') {
  const amountMicrousd = Number.parseInt(process.argv[4] ?? '', 10);
  const iterations = Number.parseInt(process.argv[5] ?? '', 10);
  if (!Number.isSafeInteger(amountMicrousd) || amountMicrousd < 0) {
    throw new Error('amountMicrousd must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(iterations) || iterations < 1) {
    throw new Error('iterations must be a positive safe integer');
  }

  for (let index = 0; index < iterations; index += 1) {
    withImmediateTransaction(db, () => {
      db.prepare(`
        UPDATE governance_budget_state
        SET spent_microusd = spent_microusd + ?, revision = revision + 1
        WHERE singleton_id = 1
      `).run(amountMicrousd);
    });
  }
} else if (operation === 'trip-and-exit') {
  const tripAt = new Date(1_700_000_001_000).toISOString();
  withImmediateTransaction(db, () => {
    db.prepare(`
      UPDATE governance_budget_state
      SET stasis_active = 1,
          trip_code = 'LOGIC_BLOCKER',
          trip_at = ?,
          resumed_by = NULL,
          stasis_message = 'child process trip',
          revision = revision + 1
      WHERE singleton_id = 1
    `).run(tripAt);
  });
  process.exit(0);
} else {
  throw new Error(`Unknown operation: ${operation}`);
}

db.close();
