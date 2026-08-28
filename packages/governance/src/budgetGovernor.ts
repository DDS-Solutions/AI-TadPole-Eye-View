import type { DatabaseSync } from 'node:sqlite';
import {
  type Actor,
  type BudgetGovernor,
  type BudgetState,
  BudgetState as BudgetStateSchema,
  type CostEstimate,
  CostEstimate as CostEstimateSchema,
  type TripCode,
  type Verdict,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';
import { openGovernanceDatabase, withImmediateTransaction } from './governanceDb.js';

const MICRO_USD_PER_USD = 1_000_000;

interface BudgetStateRow {
  period_start: string;
  spent_microusd: number;
  cap_microusd: number;
  warn_threshold_pct: number;
  stasis_active: number;
  trip_code: string | null;
  trip_at: string | null;
  resumed_by: string | null;
  stasis_message: string | null;
  revision: number;
}

export interface CapBudgetGovernorOptions {
  capUsd?: number;
  spentUsd?: number;
  warnThresholdPct?: number;
  clock?: SimClock;
  dbPath?: string;
}

function toMicrousd(
  value: number,
  field: string,
  allowZero: boolean,
  rounding: 'up' | 'down'
): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${field} must be a finite ${allowZero ? 'non-negative' : 'positive'} number`);
  }
  const scaled = value * MICRO_USD_PER_USD;
  const microusd = rounding === 'up' ? Math.ceil(scaled) : Math.floor(scaled);
  if (!Number.isSafeInteger(microusd) || (!allowZero && microusd === 0)) {
    throw new Error(`${field} is outside the supported micro-USD range`);
  }
  return microusd;
}

function fromMicrousd(value: number): number {
  return value / MICRO_USD_PER_USD;
}

function parseWarnThreshold(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('warnThresholdPct must be an integer from 1 through 100');
  }
  return value;
}

/**
 * SQLite-backed budget governor with transactionally shared STASIS state.
 * Every read observes the durable row, and every mutation uses BEGIN IMMEDIATE
 * so separate server, CLI, and MCP processes cannot overwrite one another.
 */
export class CapBudgetGovernor implements BudgetGovernor {
  private readonly clock: SimClock;
  private readonly db: DatabaseSync;
  private readonly dbPath: string;
  private closed = false;

  constructor(options: CapBudgetGovernorOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    const opened = openGovernanceDatabase({ dbPath: options.dbPath, clock: this.clock });
    this.db = opened.db;
    this.dbPath = opened.dbPath;

    const envCapRaw = process.env.GEV_BUDGET_CAP_USD;
    const envCap = envCapRaw ? Number.parseFloat(envCapRaw) : undefined;
    const capUsd = options.capUsd ?? envCap ?? 10;
    const spentUsd = options.spentUsd ?? 0;
    const warnThresholdPct = options.warnThresholdPct ?? 80;
    const capMicrousd = toMicrousd(capUsd, 'capUsd', false, 'down');
    const spentMicrousd = toMicrousd(spentUsd, 'spentUsd', true, 'up');
    const warnThreshold = parseWarnThreshold(warnThresholdPct);
    const capIsExplicit = options.capUsd !== undefined || envCapRaw !== undefined;

    try {
      withImmediateTransaction(this.db, () => {
        const existing = this.readRowOrNull();
        if (existing) {
          if (capIsExplicit && existing.cap_microusd !== capMicrousd) {
            throw new Error(
              `Configured cap $${capUsd.toFixed(6)} does not match persisted cap $${fromMicrousd(existing.cap_microusd).toFixed(6)}`
            );
          }
          if (options.spentUsd !== undefined && existing.spent_microusd !== spentMicrousd) {
            throw new Error('Configured initial spend cannot replace persisted spend');
          }
          if (
            options.warnThresholdPct !== undefined &&
            existing.warn_threshold_pct !== warnThreshold
          ) {
            throw new Error('Configured warning threshold does not match persisted threshold');
          }
          return;
        }

        const startsInStasis = spentMicrousd >= capMicrousd;
        const now = new Date(this.clock.now()).toISOString();
        this.db
          .prepare(`
            INSERT INTO governance_budget_state (
              singleton_id, period_start, spent_microusd, cap_microusd,
              warn_threshold_pct, stasis_active, trip_code, trip_at,
              resumed_by, stasis_message, revision
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0)
          `)
          .run(
            now,
            spentMicrousd,
            capMicrousd,
            warnThreshold,
            startsInStasis ? 1 : 0,
            startsInStasis ? 'BUDGET_BREACH' : null,
            startsInStasis ? now : null,
            startsInStasis
              ? `Initial spend ($${spentUsd.toFixed(2)}) meets or exceeds budget cap ($${capUsd.toFixed(2)})`
              : null
          );
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  check(action: { action: string; estimate: CostEstimate }): Verdict {
    const estimate = CostEstimateSchema.parse(action.estimate);
    const estimateMicrousd = toMicrousd(estimate.max, 'estimate.max', true, 'up');

    return withImmediateTransaction(this.db, () => {
      const row = this.readRequiredRow();
      const remainingMicrousd = Math.max(0, row.cap_microusd - row.spent_microusd);

      if (row.stasis_active === 1) {
        return {
          allowed: false,
          reason: (row.trip_code ?? 'BUDGET_BREACH') as TripCode,
          message: row.stasis_message ?? 'System is locked in STASIS mode.',
        };
      }

      if (row.spent_microusd + estimateMicrousd > row.cap_microusd) {
        const message = `Estimated spend max $${estimate.max.toFixed(2)} for ${action.action} exceeds remaining cap $${fromMicrousd(remainingMicrousd).toFixed(2)} (Cap: $${fromMicrousd(row.cap_microusd).toFixed(2)}, Spent: $${fromMicrousd(row.spent_microusd).toFixed(2)}).`;
        this.writeTrip('BUDGET_BREACH', message);
        return { allowed: false, reason: 'BUDGET_BREACH', message };
      }

      return {
        allowed: true,
        remaining_usd: fromMicrousd(remainingMicrousd - estimateMicrousd),
      };
    });
  }

  trip(reason: TripCode, message: string): void {
    if (!message.trim()) {
      throw new Error('STASIS trip message cannot be empty');
    }
    withImmediateTransaction(this.db, () => this.writeTrip(reason, message));
  }

  state(): BudgetState {
    return this.toBudgetState(this.readRequiredRow());
  }

  stateRevision(): number {
    return this.readRequiredRow().revision;
  }

  isSharedAuthority(): boolean {
    return this.dbPath !== ':memory:';
  }

  recordSpend(amountUsd: number): void {
    const amountMicrousd = toMicrousd(amountUsd, 'Spend amount', true, 'up');
    withImmediateTransaction(this.db, () => {
      const row = this.readRequiredRow();
      const spentMicrousd = row.spent_microusd + amountMicrousd;
      if (!Number.isSafeInteger(spentMicrousd)) {
        throw new Error('Settled spend is outside the supported micro-USD range');
      }

      const shouldTrip = spentMicrousd >= row.cap_microusd && row.stasis_active === 0;
      const now = new Date(this.clock.now()).toISOString();
      const message = shouldTrip
        ? `Settled spend ($${fromMicrousd(spentMicrousd).toFixed(2)}) met or exceeded budget cap ($${fromMicrousd(row.cap_microusd).toFixed(2)}).`
        : row.stasis_message;

      this.db
        .prepare(`
          UPDATE governance_budget_state
          SET spent_microusd = ?,
              stasis_active = ?,
              trip_code = ?,
              trip_at = ?,
              resumed_by = ?,
              stasis_message = ?,
              revision = revision + 1
          WHERE singleton_id = 1
        `)
        .run(
          spentMicrousd,
          shouldTrip ? 1 : row.stasis_active,
          shouldTrip ? 'BUDGET_BREACH' : row.trip_code,
          shouldTrip ? now : row.trip_at,
          shouldTrip ? null : row.resumed_by,
          message
        );
    });
  }

  /** Human-only resume mechanism (PLAN.md §9 and RUNBOOK.md STASIS). */
  resume(resumedBy: Actor = 'human'): void {
    if (resumedBy !== 'human') {
      throw new Error('STASIS resume requires a human actor');
    }

    withImmediateTransaction(this.db, () => {
      this.db
        .prepare(`
          UPDATE governance_budget_state
          SET stasis_active = 0,
              resumed_by = CASE WHEN trip_code IS NULL THEN NULL ELSE ? END,
              stasis_message = NULL,
              revision = revision + 1
          WHERE singleton_id = 1
        `)
        .run(resumedBy);
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.db.close();
  }

  private readRowOrNull(): BudgetStateRow | null {
    const row = this.db
      .prepare('SELECT * FROM governance_budget_state WHERE singleton_id = 1')
      .get() as BudgetStateRow | undefined;
    return row ?? null;
  }

  private readRequiredRow(): BudgetStateRow {
    const row = this.readRowOrNull();
    if (!row) {
      throw new Error('Durable governance budget state is missing; refusing fallback');
    }
    if (
      !Number.isSafeInteger(row.spent_microusd) ||
      row.spent_microusd < 0 ||
      !Number.isSafeInteger(row.cap_microusd) ||
      row.cap_microusd <= 0 ||
      (row.stasis_active !== 0 && row.stasis_active !== 1) ||
      (row.resumed_by !== null && row.resumed_by !== 'human')
    ) {
      throw new Error('Durable governance budget row is invalid');
    }
    this.toBudgetState(row);
    if (!Number.isSafeInteger(row.revision) || row.revision < 0) {
      throw new Error('Durable governance budget revision is invalid');
    }
    return row;
  }

  private toBudgetState(row: BudgetStateRow): BudgetState {
    return BudgetStateSchema.parse({
      stasis_active: row.stasis_active === 1,
      period_start: row.period_start,
      spent_usd: fromMicrousd(row.spent_microusd),
      cap_usd: fromMicrousd(row.cap_microusd),
      warn_threshold_pct: row.warn_threshold_pct,
      last_trip:
        row.trip_code && row.trip_at
          ? {
              code: row.trip_code,
              at: row.trip_at,
              ...(row.resumed_by ? { resumed_by: row.resumed_by } : {}),
            }
          : null,
    });
  }

  private writeTrip(reason: TripCode, message: string): void {
    this.db
      .prepare(`
        UPDATE governance_budget_state
        SET stasis_active = 1,
            trip_code = ?,
            trip_at = ?,
            resumed_by = NULL,
            stasis_message = ?,
            revision = revision + 1
        WHERE singleton_id = 1
      `)
      .run(reason, new Date(this.clock.now()).toISOString(), message);
  }
}
