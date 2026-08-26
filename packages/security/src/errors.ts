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

export class OverpassSanitizationError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'OVERPASS_QUERY_REJECTED'
  ) {
    super(`[OverpassSanitizer] ${code}: ${message}`);
    this.name = 'OverpassSanitizationError';
  }
}
