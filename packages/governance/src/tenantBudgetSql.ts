import type { DatabaseSync } from 'node:sqlite';
import type { Actor, TripCode } from '@gev/contracts';
import type { SimClock } from '@gev/core';
import { withImmediateTransaction } from './governanceDb.js';
import { fromMicrousd, toMicrousd } from './money.js';
import type { BudgetStateRow, TenantBudgetStateRow } from './stasisNotifier.js';

/** Ensures a tenant budget row exists, inheriting the global cap on creation. */
export function ensureTenantBudgetRow(
  db: DatabaseSync,
  clock: SimClock,
  tenantId: string,
  readRequiredRow: () => BudgetStateRow
): TenantBudgetStateRow {
  const existing = db
    .prepare('SELECT * FROM governance_tenant_budgets WHERE tenant_id = ?')
    .get(tenantId) as TenantBudgetStateRow | undefined;
  if (existing) return existing;

  const globalRow = readRequiredRow();
  const now = new Date(clock.now()).toISOString();
  db.prepare(`
      INSERT OR IGNORE INTO governance_tenant_budgets (
        tenant_id, period_start, spent_microusd, cap_microusd,
        warn_threshold_pct, stasis_active, trip_code, trip_at,
        resumed_by, stasis_message, revision
      ) VALUES (?, ?, 0, ?, 80, 0, NULL, NULL, NULL, NULL, 0)
    `).run(tenantId, now, globalRow.cap_microusd);

  return db
    .prepare('SELECT * FROM governance_tenant_budgets WHERE tenant_id = ?')
    .get(tenantId) as unknown as TenantBudgetStateRow;
}

/** Trips durable STASIS for a single tenant budget row. */
export function writeTenantBudgetTrip(
  db: DatabaseSync,
  clock: SimClock,
  tenantId: string,
  reason: TripCode,
  message: string
): void {
  db.prepare(`
      UPDATE governance_tenant_budgets
      SET stasis_active = 1,
          trip_code = ?,
          trip_at = ?,
          resumed_by = NULL,
          stasis_message = ?,
          revision = revision + 1
      WHERE tenant_id = ?
    `).run(reason, new Date(clock.now()).toISOString(), message, tenantId);
}

/** Atomically records settled tenant spend and trips tenant STASIS when cap is reached. */
export function recordTenantBudgetSpend(
  db: DatabaseSync,
  clock: SimClock,
  tenantId: string,
  amountUsd: number,
  readRequiredRow: () => BudgetStateRow
): void {
  const amountMicrousd = toMicrousd(amountUsd, 'Spend amount', true, 'up');
  withImmediateTransaction(db, () => {
    const row = ensureTenantBudgetRow(db, clock, tenantId, readRequiredRow);
    const spentMicrousd = row.spent_microusd + amountMicrousd;
    if (!Number.isSafeInteger(spentMicrousd)) {
      throw new Error('Tenant settled spend is outside the supported micro-USD range');
    }

    const shouldTrip = spentMicrousd >= row.cap_microusd && row.stasis_active === 0;
    const now = new Date(clock.now()).toISOString();
    const message = shouldTrip
      ? `Tenant settled spend ($${fromMicrousd(spentMicrousd).toFixed(2)}) met or exceeded budget cap ($${fromMicrousd(row.cap_microusd).toFixed(2)}).`
      : row.stasis_message;

    db.prepare(`
        UPDATE governance_tenant_budgets
        SET spent_microusd = ?,
            stasis_active = ?,
            trip_code = ?,
            trip_at = ?,
            resumed_by = ?,
            stasis_message = ?,
            revision = revision + 1
        WHERE tenant_id = ?
      `).run(
      spentMicrousd,
      shouldTrip ? 1 : row.stasis_active,
      shouldTrip ? 'BUDGET_BREACH' : row.trip_code,
      shouldTrip ? now : row.trip_at,
      shouldTrip ? null : row.resumed_by,
      message,
      tenantId
    );
  });
}

/** Updates the durable cap for a single tenant budget row. */
export function setTenantBudgetCap(
  db: DatabaseSync,
  clock: SimClock,
  tenantId: string,
  capUsd: number,
  readRequiredRow: () => BudgetStateRow
): void {
  const capMicrousd = toMicrousd(capUsd, 'capUsd', false, 'down');
  withImmediateTransaction(db, () => {
    ensureTenantBudgetRow(db, clock, tenantId, readRequiredRow);
    db.prepare(`
        UPDATE governance_tenant_budgets
        SET cap_microusd = ?, revision = revision + 1
        WHERE tenant_id = ?
      `).run(capMicrousd, tenantId);
  });
}

/** Clears tenant STASIS when authorized by a human operator. */
export function resumeTenantBudget(
  db: DatabaseSync,
  clock: SimClock,
  tenantId: string,
  resumedBy: Actor,
  readRequiredRow: () => BudgetStateRow
): void {
  if (resumedBy !== 'human') {
    throw new Error('STASIS resume requires a human actor');
  }
  withImmediateTransaction(db, () => {
    ensureTenantBudgetRow(db, clock, tenantId, readRequiredRow);
    db.prepare(`
        UPDATE governance_tenant_budgets
        SET stasis_active = 0,
            resumed_by = CASE WHEN trip_code IS NULL THEN NULL ELSE ? END,
            stasis_message = NULL,
            revision = revision + 1
        WHERE tenant_id = ?
      `).run(resumedBy, tenantId);
  });
}
