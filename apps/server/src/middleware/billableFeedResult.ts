import { Buffer } from 'node:buffer';

export const MAX_FEED_BODY_BYTES = 10 * 1024 * 1024; // 10 MB limit

export interface FeedTerminalResult {
  kind: 'gev.feed.terminal.v1';
  status: number;
  contentType: string;
  body: unknown;
}

export async function readFeedTerminalResponse(
  response: Response,
  maxBytes = MAX_FEED_BODY_BYTES
): Promise<FeedTerminalResult> {
  const contentType = response.headers.get('Content-Type') ?? 'application/octet-stream';
  const contentLength = response.headers.get('Content-Length');
  if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
    return {
      kind: 'gev.feed.terminal.v1',
      status: 413,
      contentType: 'application/json',
      body: {
        error: 'Feed response body exceeded maximum allowable size',
        code: 'OUTPUT_TOO_LARGE',
      },
    };
  }

  let body: unknown = null;
  try {
    const cloned = response.clone();
    const reader = cloned.body?.getReader();
    if (!reader) {
      const text = await cloned.text();
      if (Buffer.byteLength(text) > maxBytes) {
        return {
          kind: 'gev.feed.terminal.v1',
          status: 413,
          contentType: 'application/json',
          body: {
            error: 'Feed response body exceeded maximum allowable size',
            code: 'OUTPUT_TOO_LARGE',
          },
        };
      }
      body = contentType.includes('json') ? JSON.parse(text) : text;
    } else {
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let done = false;
      while (!done) {
        const { value, done: isDone } = await reader.read();
        done = isDone;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            return {
              kind: 'gev.feed.terminal.v1',
              status: 413,
              contentType: 'application/json',
              body: {
                error: 'Feed response body exceeded maximum allowable size',
                code: 'OUTPUT_TOO_LARGE',
              },
            };
          }
          chunks.push(value);
        }
      }
      const combined = Buffer.concat(chunks);
      const text = combined.toString('utf-8');
      body = contentType.includes('json') ? JSON.parse(text) : text;
    }
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
