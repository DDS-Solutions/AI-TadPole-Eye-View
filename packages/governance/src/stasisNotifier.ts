import {
  type Actor,
  type BudgetState,
  BudgetState as BudgetStateSchema,
  type TripCode,
} from '@gev/contracts';
import { fromMicrousd } from './money.js';

export interface StasisEvent {
  kind: 'stasis.entered' | 'stasis.resumed';
  ts: string;
  stasis_active: boolean;
  trip_code?: TripCode;
  message?: string;
  resumed_by?: Actor;
  revision: number;
}

export type StasisListener = (event: StasisEvent) => void;

export class StasisNotificationBus {
  private readonly listeners = new Set<StasisListener>();

  subscribe(listener: StasisListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: StasisEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Isolate subscriber errors from governance mutations.
      }
    }
  }
}

export interface BudgetStateRow {
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

export interface TenantBudgetStateRow {
  tenant_id: string;
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

export function parseWarnThreshold(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('warnThresholdPct must be an integer from 1 through 100');
  }
  return value;
}

export function mapBudgetStateRow(row: BudgetStateRow | TenantBudgetStateRow): BudgetState {
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

export function assertValidBudgetStateRow(row: BudgetStateRow): void {
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
  mapBudgetStateRow(row);
  if (!Number.isSafeInteger(row.revision) || row.revision < 0) {
    throw new Error('Durable governance budget revision is invalid');
  }
}
