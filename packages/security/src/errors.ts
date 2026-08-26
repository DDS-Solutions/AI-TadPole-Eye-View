export class PinnedFetchSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinnedFetchSecurityError';
  }
}

export class MaxBytesExceededError extends Error {
  constructor(
    public readonly maxBytes: number,
    public readonly receivedBytes: number
  ) {
    super(
      `Response exceeded max byte limit of ${maxBytes} bytes (received ${receivedBytes} bytes)`
    );
    this.name = 'MaxBytesExceededError';
  }
}
