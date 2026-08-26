import {
  type Actor,
  type BudgetGovernor,
  type BudgetState,
  type CostEstimate,
  CostEstimate as CostEstimateSchema,
  type TripCode,
  type Verdict,
} from '@gev/contracts';
import { type SimClock, SystemClock } from '@gev/core';

export interface CapBudgetGovernorOptions {
  capUsd?: number;
  spentUsd?: number;
  warnThresholdPct?: number;
  clock?: SimClock;
}

/**
 * Budget Governor Stub with STASIS Tripwire (Rule 2, PLAN.md §6/§9 & ADR-0016)
 * Governs spend estimates and trips STASIS lock on threshold breach.
 */
export class CapBudgetGovernor implements BudgetGovernor {
  private readonly capUsd: number;
  private readonly warnThresholdPct: number;
  private readonly clock: SimClock;
  private readonly periodStart: string;
  private spentUsd = 0;
  private stasisActive = false;
  private lastTrip: { code: TripCode; at: string; resumed_by?: Actor } | null = null;
  private stasisMessage: string | null = null;

  constructor(options: CapBudgetGovernorOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.periodStart = new Date(this.clock.now()).toISOString();
    const envCap = process.env.GEV_BUDGET_CAP_USD
      ? Number.parseFloat(process.env.GEV_BUDGET_CAP_USD)
      : undefined;
    this.capUsd = options.capUsd ?? envCap ?? 10.0;
    this.warnThresholdPct = options.warnThresholdPct ?? 80;
    this.spentUsd = options.spentUsd ?? 0;

    if (this.spentUsd >= this.capUsd) {
      this.trip(
        'BUDGET_BREACH',
        `Initial spend ($${this.spentUsd.toFixed(2)}) meets or exceeds budget cap ($${this.capUsd.toFixed(2)})`
      );
    }
  }

  /**
   * Evaluates cost estimate before any spend-bearing action runs.
   */
  check(a: { action: string; estimate: CostEstimate }): Verdict {
    const estimate = CostEstimateSchema.parse(a.estimate);
    const remaining = Math.max(0, this.capUsd - this.spentUsd);

    // Rule 2: If STASIS is active, ALL mutating/spend-bearing actions halt
    if (this.stasisActive) {
      return {
        allowed: false,
        reason: this.lastTrip?.code ?? 'BUDGET_BREACH',
        message: this.stasisMessage ?? 'System is locked in STASIS mode.',
      };
    }

    if (this.spentUsd + estimate.max > this.capUsd) {
      this.trip(
        'BUDGET_BREACH',
        `Estimated spend max $${estimate.max.toFixed(2)} for ${a.action} exceeds remaining cap $${remaining.toFixed(2)} (Cap: $${this.capUsd.toFixed(2)}, Spent: $${this.spentUsd.toFixed(2)}).`
      );

      return {
        allowed: false,
        reason: 'BUDGET_BREACH',
        message: this.stasisMessage ?? 'Budget cap breached',
      };
    }

    return {
      allowed: true,
      remaining_usd: remaining - estimate.max,
    };
  }

  /**
   * Trips STASIS lockdown mode.
   */
  trip(reason: TripCode, message: string): void {
    this.stasisActive = true;
    this.stasisMessage = message;
    this.lastTrip = {
      code: reason,
      at: new Date(this.clock.now()).toISOString(),
    };
  }

  /**
   * Returns complete budget and STASIS state.
   */
  state(): BudgetState {
    return {
      stasis_active: this.stasisActive,
      period_start: this.periodStart,
      spent_usd: this.spentUsd,
      cap_usd: this.capUsd,
      warn_threshold_pct: this.warnThresholdPct,
      last_trip: this.lastTrip,
    };
  }

  /**
   * Records settled dollar spend.
   */
  recordSpend(amountUsd: number): void {
    if (amountUsd < 0) {
      throw new Error('Spend amount cannot be negative');
    }

    this.spentUsd += amountUsd;

    if (this.spentUsd >= this.capUsd && !this.stasisActive) {
      this.trip(
        'BUDGET_BREACH',
        `Settled spend ($${this.spentUsd.toFixed(2)}) exceeded budget cap ($${this.capUsd.toFixed(2)}).`
      );
    }
  }

  /**
   * Human-only resume mechanism (PLAN.md §9 & RUNBOOK.md §STASIS).
   */
  resume(resumedBy: Actor = 'human'): void {
    this.stasisActive = false;
    this.stasisMessage = null;
    if (this.lastTrip) {
      this.lastTrip.resumed_by = resumedBy;
    }
  }
}
