import { describe, expect, it } from 'vitest';
import { FrozenClock, SteppableClock, SystemClock } from '../src/clock.js';

describe('Sim-Clock Abstractions', () => {
  it('FrozenClock remains invariant unless manually updated', () => {
    const clock = new FrozenClock(1724580000000);
    expect(clock.now()).toBe(1724580000000);
    expect(clock.iso()).toBe('2024-08-25T10:00:00.000Z');

    clock.setTime(1724580060000);
    expect(clock.now()).toBe(1724580060000);
    expect(clock.iso()).toBe('2024-08-25T10:01:00.000Z');
  });

  it('SteppableClock advances strictly according to tick intervals and rates', () => {
    const clock = new SteppableClock(1724580000000, 2); // 2x rate
    clock.tick(1000); // 1000ms delta * 2x rate = +2000ms
    expect(clock.now()).toBe(1724580002000);
  });

  it('SystemClock provides current ISO date string', () => {
    const clock = new SystemClock();
    expect(clock.now()).toBeGreaterThan(0);
    expect(new Date(clock.iso()).getTime()).toBeGreaterThan(0);
  });
});
