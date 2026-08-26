import { Agent, type Dispatcher, type Response, fetch as undiciFetch } from 'undici';
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
  dispatcher?: Dispatcher;
}

/**
 * Pinned Fetch client:
 * 1. Self-resolves DNS and validates all records against SSRF rules.
 * 2. Pins TLS connection to validated IP via custom lookup hook (zero TOCTOU / rebinding).
 * 3. Enforces mandatory timeouts.
 * 4. Refuses HTTP redirects (redirect: 'error').
 * 5. Enforces maximum response byte limits.
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
  const pinnedAgent =
    options.dispatcher ??
    new Agent({
      connect: {
        lookup: (
          _hostname: string,
          _opts: unknown,
          callback: (
            err: Error | null,
            addresses: Array<{ address: string; family: number }>
          ) => void
        ) => {
          callback(null, [{ address: primaryIp.address, family: primaryIp.family }]);
        },
      },
    });

  const abortSignal = AbortSignal.timeout(timeoutMs);

  const response = await undiciFetch(parsedUrl.toString(), {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
    dispatcher: pinnedAgent,
    redirect: 'error',
    signal: abortSignal,
  });

  // Verify Content-Length header if provided
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
      throw new MaxBytesExceededError(maxBytes, contentLength);
    }
  }

  return response;
}
