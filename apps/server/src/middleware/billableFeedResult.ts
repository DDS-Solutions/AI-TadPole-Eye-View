export interface FeedTerminalResult {
  kind: 'gev.feed.terminal.v1';
  status: number;
  contentType: string;
  body: unknown;
}

export async function readFeedTerminalResponse(response: Response): Promise<FeedTerminalResult> {
  const contentType = response.headers.get('Content-Type') ?? 'application/octet-stream';
  let body: unknown = null;
  try {
    const text = await response.clone().text();
    body = contentType.includes('json') ? JSON.parse(text) : text;
  } catch {
    body = null;
  }
  return { kind: 'gev.feed.terminal.v1', status: response.status, contentType, body };
}

export function isFeedTerminal(value: unknown): value is FeedTerminalResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FeedTerminalResult>;
  return (
    candidate.kind === 'gev.feed.terminal.v1' &&
    typeof candidate.status === 'number' &&
    typeof candidate.contentType === 'string'
  );
}

export function feedFailureResult(operationId: string, code: string, error: string) {
  return {
    success: false,
    status: 'error' as const,
    intent_id: operationId,
    code,
    error,
  };
}

export async function withRequestTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Billable provider request timed out')),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
