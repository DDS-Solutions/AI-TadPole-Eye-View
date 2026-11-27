import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  consumeDailyBudget,
  isOverDailyBudget,
  normalizeDailyBudget,
  utcDayKey,
} from '../src/dailyReadBudget.js';

describe('UTC Daily Read Budget Governance Helper', () => {
  it('formats SimClock epoch timestamps into UTC YYYY-MM-DD keys without ambient Date.now()', () => {
    expect(utcDayKey(Date.UTC(2026, 10, 12, 23, 59, 59))).toBe('2026-11-12');
    expect(() => utcDayKey(Number.NaN)).toThrow('finite epoch timestamp');
  });

  it('normalizes corrupt/stale period state and rolls counters cleanly at midnight UTC', () => {
    const day1 = utcDayKey(Date.UTC(2026, 10, 12, 23, 59, 0));
    const day2 = utcDayKey(Date.UTC(2026, 10, 13, 0, 1, 0));

    const existing = { date: day1, count: 25 };
    expect(normalizeDailyBudget(existing, day1)).toBe(existing);
    expect(normalizeDailyBudget(existing, day2)).toEqual({ date: day2, count: 0 });
    expect(normalizeDailyBudget({ date: day1, count: -5 }, day1)).toEqual({ date: day1, count: 0 });
  });

  it('enforces daily quota caps accurately across increments', () => {
    const day = '2026-11-12';
    const r1 = consumeDailyBudget(null, day, 3, 2);
    expect(r1).toEqual({ allowed: true, state: { date: day, count: 2 }, remaining: 1 });
    expect(isOverDailyBudget(r1.state, 3)).toBe(false);

    const r2 = consumeDailyBudget(r1.state, day, 3, 1);
    expect(r2).toEqual({ allowed: true, state: { date: day, count: 3 }, remaining: 0 });
    expect(isOverDailyBudget(r2.state, 3)).toBe(true);

    const r3 = consumeDailyBudget(r2.state, day, 3, 1);
    expect(r3).toEqual({ allowed: false, state: r2.state, remaining: 0 });
  });

  it('property: consumed count never exceeds positive integer daily limits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.array(fc.integer({ min: 1, max: 10 }), { maxLength: 25 }),
        (limit, steps) => {
          let state = normalizeDailyBudget(null, '2026-11-12');
          for (const step of steps) {
            const res = consumeDailyBudget(state, '2026-11-12', limit, step);
            state = res.state;
            expect(state.count).toBeLessThanOrEqual(limit);
          }
        }
      )
    );
  });
});
