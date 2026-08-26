import { Agent, type Dispatcher, Response, fetch as undiciFetch } from 'undici';
import { MaxBytesExceededError, PinnedFetchSecurityError } from './errors.js';
import {
  type PathAllowRule,
  SsrfBlockError,
  normalizeHost,
  resolveAndValidateHost,
  validateAllowlists,
} from './ssrf.js';

export { type PathAllowRule, PinnedFetchSecurityError, MaxBytesExceededError, validateAllowlists };

export interface PinnedFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  allowedHosts?: string[];
  allowedPaths?: PathAllowRule[];
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | null;
  customResolver?: {
    resolve4?: (h: string) => Promise<string[]>;
    resolve6?: (h: string) => Promise<string[]>;
  };
  /** TEST-ONLY: Custom dispatcher override for mocking in unit tests */
  dispatcher?: Dispatcher;
}

export type PinnedLookupCallback = (
  err: Error | null,
  addresses: Array<{ address: string; family: number }>
) => void;

export type PinnedLookupHook = (
  hostname: string,
  opts: unknown,
  callback: PinnedLookupCallback
) => void;

/**
 * Creates a custom DNS lookup callback that always returns the pinned IP address.
 */
export function createPinnedLookupHook(primaryIp: {
  address: string;
  family: number;
}): PinnedLookupHook {
  return (_hostname: string, _opts: unknown, callback: PinnedLookupCallback) => {
    callback(null, [{ address: primaryIp.address, family: primaryIp.family }]);
  };
}

/**
 * Creates an Undici Agent that pins all DNS lookups to the specified pre-validated IP address.
 */
export function createPinnedAgent(primaryIp: { address: string; family: number }): Agent {
  return new Agent({
    connect: {
      lookup: createPinnedLookupHook(primaryIp),
    },
  });
}

/**
 * Creates a byte-counting TransformStream that throws MaxBytesExceededError if the stream exceeds maxBytes.
 */
export function createByteCountingStream(maxBytes: number): TransformStream {
  let bytesRead = 0;
  return new TransformStream({
    transform(chunk: Uint8Array, controller) {
      bytesRead += chunk.byteLength;
      if (bytesRead > maxBytes) {
        controller.error(new MaxBytesExceededError(maxBytes, bytesRead));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

/**
 * Pinned Fetch client:
 * 1. Self-resolves DNS and validates all records against SSRF rules.
 * 2. Pins TLS connection to validated IP via custom lookup hook (zero TOCTOU / rebinding).
 * 3. Enforces mandatory timeouts.
 * 4. Refuses HTTP redirects (redirect: 'error').
 * 5. Enforces maximum response byte limits (Content-Length fast-path + streaming counting wrapper).
 * 6. Refuses credentials in URL (username:password).
 */
export async function pinnedFetch(
  targetUrl: string | URL,
  options: PinnedFetchOptions = {}
): Promise<Response> {
  const parsedUrl = typeof targetUrl === 'string' ? new URL(targetUrl) : targetUrl;

  // Only allow HTTP/HTTPS
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new PinnedFetchSecurityError(`Unsupported protocol: ${parsedUrl.protocol}`);
  }

  // Reject userinfo in URLs (username:password)
  if (parsedUrl.username || parsedUrl.password) {
    throw new PinnedFetchSecurityError(
      'Userinfo (username:password) in URL is forbidden for security'
    );
  }

  // Validate allowlists if specified
  validateAllowlists(parsedUrl, options.allowedHosts, options.allowedPaths);

  const normalizedHostname = normalizeHost(parsedUrl.hostname);
  const validatedIps = await resolveAndValidateHost(normalizedHostname, options.customResolver);

  const primaryIp = validatedIps[0];
  if (!primaryIp) {
    throw new SsrfBlockError(`No valid IP addresses available for ${parsedUrl.hostname}`);
  }

  const timeoutMs = options.timeoutMs ?? 10000;
  const maxBytes = options.maxBytes ?? 50 * 1024 * 1024;

  // Custom agent pinning socket connection directly to the pre-validated IP
  const pinnedAgent = options.dispatcher ?? createPinnedAgent(primaryIp);
  const ownsAgent = !options.dispatcher; // only close agents we created

  const abortSignal = AbortSignal.timeout(timeoutMs);

  const response = await undiciFetch(parsedUrl.toString(), {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
    dispatcher: pinnedAgent,
    redirect: 'error',
    signal: abortSignal,
  });

  // Fast-path: Verify Content-Length header if provided
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
      if (ownsAgent && pinnedAgent instanceof Agent) pinnedAgent.close();
      throw new MaxBytesExceededError(maxBytes, contentLength);
    }
  }

  // Helper: creates a TransformStream that closes the agent when the body stream ends
  function createAgentCleanupStream(): TransformStream {
    return new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush() {
        if (ownsAgent && pinnedAgent instanceof Agent) {
          pinnedAgent.close();
        }
      },
    });
  }

  // Enforce byte cap on streamed / chunked body response
  if (response.body) {
    // biome-ignore lint/suspicious/noExplicitAny: Standard TransformStream bridge across undici/DOM stream definitions
    const cappedBody = (response.body as any)
      .pipeThrough(createByteCountingStream(maxBytes))
      .pipeThrough(createAgentCleanupStream());
    return new Response(cappedBody as unknown as string, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  // No body — close agent immediately
  if (ownsAgent && pinnedAgent instanceof Agent) {
    pinnedAgent.close();
  }

  return response;
}
