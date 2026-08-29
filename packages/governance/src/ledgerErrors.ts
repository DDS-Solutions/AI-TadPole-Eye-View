export class LedgerOperationError extends Error {
  constructor(
    public readonly code:
      | 'LEDGER_UNAVAILABLE'
      | 'IDEMPOTENCY_CONFLICT'
      | 'INVALID_LEDGER_TRANSITION'
      | 'RESERVATION_EXPIRED',
    message: string
  ) {
    super(message);
    this.name = 'LedgerOperationError';
  }
}

export function unavailableLedger(): LedgerOperationError {
  return new LedgerOperationError('LEDGER_UNAVAILABLE', 'Durable budget ledger unavailable');
}

export function transitionRace(): LedgerOperationError {
  return new LedgerOperationError('INVALID_LEDGER_TRANSITION', 'Ledger state changed concurrently');
}
