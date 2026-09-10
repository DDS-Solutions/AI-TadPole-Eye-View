import crypto from 'node:crypto';
import type { createGevMcpHttpHandler } from '@gev/ops-mcp/http';
import { originValidation } from '@modelcontextprotocol/hono';
import { Hono } from 'hono';

export const MCP_HTTP_RESOURCE = 'http://127.0.0.1:3000/mcp';
export const MCP_HTTP_HOST = '127.0.0.1:3000';
export const MCP_HTTP_MAX_BODY_BYTES = 1024 * 1024;
export const MCP_HTTP_MAX_HEADER_BYTES = 16 * 1024;
export const MCP_HTTP_DEFAULT_MAX_ACTIVE_REQUESTS = 100;
export const MCP_TEST_ISSUER = 'https://auth.gev.test/';
export const MCP_TEST_SUBJECT = 'svc:tadpole-test';

type GevMcpHttpHandler = ReturnType<typeof createGevMcpHttpHandler>;

export interface McpHttpTestAuthority {
  authorization: string;
  issuer: typeof MCP_TEST_ISSUER;
  subject: typeof MCP_TEST_SUBJECT;
  audience: typeof MCP_HTTP_RESOURCE;
  scopes: readonly string[];
  issuedAtEpochSeconds: number;
  expiresAtEpochSeconds: number;
}

export interface McpHttpRouterOptions {
  handler: GevMcpHttpHandler;
  now: () => number;
  testAuthority?: McpHttpTestAuthority;
  maxActiveRequests?: number;
}

export interface McpHttpRouteLifecycle {
  router: Hono;
  close: () => Promise<void>;
  activeRequestCount: () => number;
  peakActiveRequestCount: () => number;
}

interface ExchangeLease {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  release: () => void;
}

class ExchangeGate {
  private readonly controllers = new Map<symbol, AbortController>();
  private closed = false;
  private peak = 0;

  constructor(private readonly maximum: number) {}

  acquire(sourceSignal: AbortSignal): ExchangeLease | undefined {
    if (this.closed || this.controllers.size >= this.maximum) {
      return undefined;
    }

    const key = Symbol('mcp-http-exchange');
    const controller = new AbortController();
    const relayAbort = () => controller.abort(sourceSignal.reason);
    if (sourceSignal.aborted) {
      relayAbort();
    } else {
      sourceSignal.addEventListener('abort', relayAbort, { once: true });
    }
    this.controllers.set(key, controller);
    this.peak = Math.max(this.peak, this.controllers.size);
    let released = false;

    return {
      signal: controller.signal,
      abort: (reason?: unknown) => controller.abort(reason),
      release: () => {
        if (released) return;
        released = true;
        sourceSignal.removeEventListener('abort', relayAbort);
        this.controllers.delete(key);
      },
    };
  }

  isClosed(): boolean {
    return this.closed;
  }

  activeCount(): number {
    return this.controllers.size;
  }

  peakCount(): number {
    return this.peak;
  }

  abortAll(): void {
    this.closed = true;
    for (const controller of this.controllers.values()) {
      controller.abort(new Error('MCP HTTP handler is shutting down'));
    }
  }

  releaseAll(): void {
    this.controllers.clear();
  }
}

class BodyLimitError extends Error {}

function jsonRpcHttpError(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function secureHeaderEquals(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    crypto.timingSafeEqual(actualBytes, expectedBytes)
  );
}

function explicitlyAccepts(header: string | undefined, mediaType: string): boolean {
  if (header === undefined) return false;
  return header.split(',').some((entry) => {
    const [rawType, ...parameters] = entry.split(';');
    if (rawType?.trim().toLowerCase() !== mediaType) return false;
    return !parameters.some((parameter) => {
      const [name, value] = parameter.split('=', 2).map((part) => part.trim().toLowerCase());
      return name === 'q' && Number(value) === 0;
    });
  });
}

function headerBytes(headers: Headers): number {
  let total = 0;
  for (const [name, value] of headers) {
    total += Buffer.byteLength(name, 'utf8') + Buffer.byteLength(value, 'utf8') + 4;
  }
  return total;
}

function validateTestAuthority(authority: McpHttpTestAuthority): void {
  if (
    authority.issuer !== MCP_TEST_ISSUER ||
    authority.subject !== MCP_TEST_SUBJECT ||
    authority.audience !== MCP_HTTP_RESOURCE
  ) {
    throw new Error('MCP test authority does not match the accepted local profile');
  }
  if (!authority.authorization.startsWith('Bearer ') || authority.authorization.length <= 7) {
    throw new Error('MCP test authority must provide a complete bearer authorization value');
  }
  if (/\r|\n/.test(authority.authorization)) {
    throw new Error('MCP test authority contains an invalid authorization value');
  }
  if (
    !Number.isFinite(authority.issuedAtEpochSeconds) ||
    !Number.isFinite(authority.expiresAtEpochSeconds) ||
    authority.issuedAtEpochSeconds >= authority.expiresAtEpochSeconds
  ) {
    throw new Error('MCP test authority has an invalid issuance window');
  }
}

function toAuthInfo(authority: McpHttpTestAuthority) {
  return {
    token: authority.authorization.slice('Bearer '.length),
    clientId: authority.subject,
    scopes: [...authority.scopes],
    expiresAt: authority.expiresAtEpochSeconds,
    resource: new URL(authority.audience),
    extra: {
      issuer: authority.issuer,
      subject: authority.subject,
    },
  };
}

async function readBoundedRequest(
  request: Request,
  signal: AbortSignal,
  maximumBytes: number
): Promise<Request> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new Error('Invalid Content-Length header');
    }
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes)) {
      throw new Error('Invalid Content-Length header');
    }
    if (bytes > maximumBytes) {
      throw new BodyLimitError(`MCP request body exceeds ${maximumBytes} bytes`);
    }
  }

  if (request.body === null) {
    return new Request(request.url, {
      method: request.method,
      headers: request.headers,
      signal,
    });
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancelRead = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', cancelRead, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel('MCP request body limit exceeded').catch(() => undefined);
        throw new BodyLimitError(`MCP request body exceeds ${maximumBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancelRead);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal,
  });
}

function responseWithLease(response: Response, lease: ExchangeLease): Response {
  if (response.body === null) {
    lease.release();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          lease.release();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        lease.release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      lease.abort(reason);
      try {
        await reader.cancel(reason);
      } finally {
        lease.release();
      }
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Mountable Hono router for the local, stateless, modern-only MCP endpoint. */
export function createMcpHttpRouter(options: McpHttpRouterOptions): McpHttpRouteLifecycle {
  const maximum = options.maxActiveRequests ?? MCP_HTTP_DEFAULT_MAX_ACTIVE_REQUESTS;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_000) {
    throw new Error('MCP maximum active request count must be an integer from 1 to 1000');
  }
  if (options.testAuthority) validateTestAuthority(options.testAuthority);

  const router = new Hono();
  const gate = new ExchangeGate(maximum);
  let closePromise: Promise<void> | undefined;

  // Empty origin allowlist: browser and cross-origin requests fail before body dispatch.
  router.use('/', originValidation([]));
  router.use('/', async (c, next) => {
    if (headerBytes(c.req.raw.headers) > MCP_HTTP_MAX_HEADER_BYTES) {
      return jsonRpcHttpError(431, -32003, 'MCP request headers exceed 16 KiB');
    }
    if (c.req.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { allow: 'POST' },
      });
    }
    if (c.req.header('host') !== MCP_HTTP_HOST) {
      return jsonRpcHttpError(403, -32003, 'Forbidden Host authority');
    }
    if (c.req.header('mcp-session-id') || c.req.header('last-event-id')) {
      return jsonRpcHttpError(400, -32020, 'Legacy MCP session headers are not supported');
    }

    const authority = options.testAuthority;
    if (!authority) {
      return jsonRpcHttpError(503, -32003, 'MCP HTTP authorization is not configured');
    }
    const nowEpochSeconds = Math.floor(options.now() / 1000);
    if (
      authority.issuedAtEpochSeconds > nowEpochSeconds ||
      authority.expiresAtEpochSeconds <= nowEpochSeconds ||
      !secureHeaderEquals(c.req.header('authorization'), authority.authorization)
    ) {
      return jsonRpcHttpError(401, -32001, 'Unauthorized');
    }
    const protocolVersion = c.req.header('mcp-protocol-version');
    const method = c.req.header('mcp-method');
    if (!protocolVersion || !method || (method === 'tools/call' && !c.req.header('mcp-name'))) {
      return jsonRpcHttpError(400, -32020, 'Required MCP mirrored header is missing');
    }
    const accept = c.req.header('accept');
    if (
      !explicitlyAccepts(accept, 'application/json') ||
      !explicitlyAccepts(accept, 'text/event-stream')
    ) {
      return jsonRpcHttpError(
        406,
        -32003,
        'Client must accept both application/json and text/event-stream'
      );
    }

    return next();
  });

  const methodNotAllowed = () =>
    new Response('Method Not Allowed', {
      status: 405,
      headers: { allow: 'POST' },
    });
  router.get('/', methodNotAllowed);
  router.delete('/', methodNotAllowed);
  router.post('/', async (c) => {
    const lease = gate.acquire(c.req.raw.signal);
    if (!lease) {
      return gate.isClosed()
        ? jsonRpcHttpError(503, -32003, 'MCP HTTP handler is shutting down')
        : jsonRpcHttpError(429, -32003, 'MCP HTTP concurrency limit reached');
    }

    let boundedRequest: Request;
    try {
      boundedRequest = await readBoundedRequest(c.req.raw, lease.signal, MCP_HTTP_MAX_BODY_BYTES);
    } catch (error) {
      lease.release();
      if (error instanceof BodyLimitError) {
        return jsonRpcHttpError(413, -32003, 'MCP request body exceeds 1 MiB');
      }
      if (lease.signal.aborted) {
        return jsonRpcHttpError(400, -32003, 'MCP request was cancelled');
      }
      return jsonRpcHttpError(400, -32700, 'Unable to read MCP request body');
    }

    const authority = options.testAuthority;
    if (!authority) {
      lease.release();
      return jsonRpcHttpError(503, -32003, 'MCP HTTP authorization is not configured');
    }
    try {
      const response = await options.handler.fetch(boundedRequest, {
        authInfo: toAuthInfo(authority),
      });
      return responseWithLease(response, lease);
    } catch {
      lease.release();
      return jsonRpcHttpError(500, -32603, 'MCP HTTP handler failed closed');
    }
  });
  router.all('/', methodNotAllowed);

  return {
    router,
    activeRequestCount: () => gate.activeCount(),
    peakActiveRequestCount: () => gate.peakCount(),
    close: () => {
      closePromise ??= (async () => {
        gate.abortAll();
        try {
          await options.handler.close();
        } finally {
          gate.releaseAll();
        }
      })();
      return closePromise;
    },
  };
}
