export interface DailyReadBudgetState {
  readonly date: string;
  readonly count: number;
}

export interface DailyBudgetConsumeResult {
  readonly allowed: boolean;
  readonly state: DailyReadBudgetState;
  readonly remaining: number | null;
}

/**
 * Formats an injected UTC epoch timestamp (from SimClock) as `YYYY-MM-DD`.
 * Callers must pass an explicit clock reading; never invokes ambient wall clock.
 */
export function utcDayKey(epochMs: number): string {
  if (!Number.isFinite(epochMs)) {
    throw new TypeError('utcDayKey requires a finite epoch timestamp in milliseconds');
  }
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Normalizes persisted daily quota state against `periodKey`, resetting on period rollover
 * or invalid/negative counts. Reuses the exact state object when already valid.
 */
export function normalizeDailyBudget(
  state: Partial<DailyReadBudgetState> | null | undefined,
  periodKey: string
): DailyReadBudgetState {
  if (
    state &&
    state.date === periodKey &&
    typeof state.count === 'number' &&
    Number.isFinite(state.count) &&
    state.count >= 0
  ) {
    return state as DailyReadBudgetState;
  }
  return { date: periodKey, count: 0 };
}

/**
 * Checks whether the current UTC period count has reached or exceeded `limit`.
 * Non-positive or non-finite limits are treated as unbounded (fail-open config sentinel only).
 */
export function isOverDailyBudget(state: DailyReadBudgetState, limit: number): boolean {
  if (!Number.isFinite(limit) || limit <= 0) {
    return false;
  }
  return state.count >= limit;
}

/**
 * Evaluates and consumes `units` against `limit` for `periodKey` without mutating input state.
 */
export function consumeDailyBudget(
  rawState: Partial<DailyReadBudgetState> | null | undefined,
  periodKey: string,
  limit: number,
  units = 1
): DailyBudgetConsumeResult {
  if (!Number.isFinite(units) || units < 0) {
    throw new TypeError('Budget consume units must be a non-negative finite number');
  }
  const normalized = normalizeDailyBudget(rawState, periodKey);
  if (Number.isFinite(limit) && limit > 0 && normalized.count + units > limit) {
    return {
      allowed: false,
      state: normalized,
      remaining: Math.max(0, limit - normalized.count),
    };
  }
  const nextState: DailyReadBudgetState = {
    date: periodKey,
    count: normalized.count + units,
  };
  return {
    allowed: true,
    state: nextState,
    remaining: Number.isFinite(limit) && limit > 0 ? Math.max(0, limit - nextState.count) : null,
  };
}
