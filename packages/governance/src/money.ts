import { MAX_SAFE_MICRO_USD } from '@gev/contracts';

export const MICRO_USD_PER_USD = 1_000_000;

export function toMicrousd(
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
  if (
    !Number.isSafeInteger(microusd) ||
    microusd > MAX_SAFE_MICRO_USD ||
    (!allowZero && microusd === 0)
  ) {
    throw new Error(`${field} is outside the supported micro-USD range`);
  }
  return microusd;
}

export function fromMicrousd(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Persisted micro-USD value is invalid');
  }
  return value / MICRO_USD_PER_USD;
}
