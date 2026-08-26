import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { PinnedFetchSecurityError } from './errors.js';

export class SsrfBlockError extends Error {
  constructor(
    message: string,
    public readonly ip?: string,
    public readonly host?: string
  ) {
    super(message);
    this.name = 'SsrfBlockError';
  }
}

export interface PathAllowRule {
  host: string;
  pathPrefix: string;
}

/**
 * Validates request destination against host and path allowlists.
 */
export function validateAllowlists(
  parsedUrl: URL,
  allowedHosts?: string[],
  allowedPaths?: PathAllowRule[]
): void {
  const host = parsedUrl.hostname.toLowerCase();
  const path = parsedUrl.pathname;

  if (allowedHosts && allowedHosts.length > 0) {
    const isHostAllowed = allowedHosts.some((h) => h.toLowerCase() === host);
    if (!isHostAllowed) {
      throw new PinnedFetchSecurityError(`Host ${host} is not in the allowed hosts list`);
    }
  }

  if (allowedPaths && allowedPaths.length > 0) {
    const isPathAllowed = allowedPaths.some(
      (rule) => rule.host.toLowerCase() === host && path.startsWith(rule.pathPrefix)
    );
    if (!isPathAllowed) {
      throw new PinnedFetchSecurityError(
        `Path ${path} on host ${host} is not allowed by path rules`
      );
    }
  }
}

/**
 * Blocked IPv4 CIDR ranges per RFC standards and PLAN.md §1.3 / §5.
 */
const IPV4_BLOCKED_CIDRS = [
  '0.0.0.0/8', // Current network (RFC 791)
  '10.0.0.0/8', // Private network (RFC 1918)
  '100.64.0.0/10', // Shared address / Carrier-grade NAT (RFC 6598)
  '127.0.0.0/8', // Loopback (RFC 1122)
  '169.254.0.0/16', // Link-local (RFC 3927)
  '172.16.0.0/12', // Private network (RFC 1918)
  '192.0.0.0/24', // IETF Protocol Assignments (RFC 6890)
  '192.0.2.0/24', // Documentation TEST-NET-1 (RFC 5737)
  '192.88.99.0/24', // 6to4 Relay Anycast (RFC 7526)
  '192.168.0.0/16', // Private network (RFC 1918)
  '198.18.0.0/15', // Benchmarking (RFC 2544)
  '198.51.100.0/24', // Documentation TEST-NET-2 (RFC 5737)
  '203.0.113.0/24', // Documentation TEST-NET-3 (RFC 5737)
  '224.0.0.0/4', // Multicast (RFC 5771)
  '240.0.0.0/4', // Reserved / future use (RFC 1112)
  '255.255.255.255/32', // Broadcast
].map((cidr) => ipaddr.parseCIDR(cidr));

/**
 * IPv6 global unicast range allowed by PLAN.md §1.3 (2000::/3).
 */
const IPV6_GLOBAL_UNICAST = ipaddr.parseCIDR('2000::/3');

/**
 * Explicitly blocked IPv6 CIDR ranges (even within or outside 2000::/3).
 */
const IPV6_BLOCKED_CIDRS = [
  '::/128', // Unspecified
  '::1/128', // Loopback
  'fe80::/10', // Link-local
  'fc00::/7', // Unique local address (ULA)
  'ff00::/8', // Multicast
  '2001:db8::/32', // Documentation
  '2001::/23', // Teredo
  '2002::/16', // 6to4
].map((cidr) => ipaddr.parseCIDR(cidr));

const NAT64_PREFIX = ipaddr.parseCIDR('64:ff9b::/96');

/**
 * Normalizes encoded URL hostnames (e.g. integer IP 2130706433, hex 0x7f.1, octal 0177.0.0.1).
 */
export function normalizeHost(host: string): string {
  let cleanHost = host.trim().toLowerCase();

  // Strip enclosing brackets for IPv6
  if (cleanHost.startsWith('[') && cleanHost.endsWith(']')) {
    cleanHost = cleanHost.slice(1, -1);
  }

  // Pure integer decimal IP (e.g. 2130706433 -> 127.0.0.1)
  if (/^\d+$/.test(cleanHost)) {
    const num = Number.parseInt(cleanHost, 10);
    if (num >= 0 && num <= 0xffffffff) {
      return [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join('.');
    }
  }

  // Dotted segments containing hex or octal numbers (e.g. 0x7f.0.0.1 or 0177.0.0.1)
  if (/^[0-9a-fx.]+/i.test(cleanHost) && cleanHost.includes('.')) {
    const parts = cleanHost.split('.');
    if (parts.length === 4 && parts.every((p) => /^(0x[0-9a-f]+|0[0-7]*|[1-9]\d*)$/i.test(p))) {
      try {
        const parsed = parts.map((p) => {
          if (p.startsWith('0x') || p.startsWith('0X')) {
            return Number.parseInt(p, 16);
          }
          if (p.startsWith('0') && p.length > 1) {
            return Number.parseInt(p, 8);
          }
          return Number.parseInt(p, 10);
        });
        if (parsed.every((n) => !Number.isNaN(n) && n >= 0 && n <= 255)) {
          return parsed.join('.');
        }
      } catch {
        // Fallback to original cleanHost
      }
    }
  }

  return cleanHost;
}

/**
 * Validates a single parsed IP address against SSRF rules.
 * Throws SsrfBlockError if the address is non-global, private, loopback, or reserved.
 */
export function validateIpAddress(ipStr: string): { address: string; family: 4 | 6 } {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;

  try {
    addr = ipaddr.parse(ipStr);
  } catch {
    throw new SsrfBlockError(`Invalid IP address representation: ${ipStr}`, ipStr);
  }

  // Unwrap IPv4-mapped IPv6 address (::ffff:x.x.x.x)
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      addr = v6.toIPv4Address();
    } else if (v6.match(NAT64_PREFIX)) {
      // NAT64 prefix embeds IPv4 in the lowest 32 bits
      const bytes = v6.toByteArray().slice(12, 16);
      addr = new ipaddr.IPv4(bytes as [number, number, number, number]);
    }
  }

  if (addr.kind() === 'ipv4') {
    const v4 = addr as ipaddr.IPv4;
    for (const cidr of IPV4_BLOCKED_CIDRS) {
      if (v4.match(cidr)) {
        throw new SsrfBlockError(
          `SSRF protection: IPv4 address ${v4.toString()} is in blocked range ${cidr[0].toString()}/${cidr[1]}`,
          v4.toString()
        );
      }
    }
    return { address: v4.toString(), family: 4 };
  }

  // IPv6 validation: Must be in 2000::/3 global unicast AND not in specific blocked subnets
  const v6 = addr as ipaddr.IPv6;
  if (!v6.match(IPV6_GLOBAL_UNICAST)) {
    throw new SsrfBlockError(
      `SSRF protection: IPv6 address ${v6.toString()} is outside global unicast 2000::/3`,
      v6.toString()
    );
  }

  for (const cidr of IPV6_BLOCKED_CIDRS) {
    if (v6.match(cidr)) {
      throw new SsrfBlockError(
        `SSRF protection: IPv6 address ${v6.toString()} is in blocked range ${cidr[0].toString()}/${cidr[1]}`,
        v6.toString()
      );
    }
  }

  return { address: v6.toString(), family: 6 };
}

/**
 * Resolves a hostname via DNS and validates ALL returned records against SSRF rules.
 * Returns the list of validated IP address records.
 */
export async function resolveAndValidateHost(
  host: string,
  customResolver?: {
    resolve4?: (h: string) => Promise<string[]>;
    resolve6?: (h: string) => Promise<string[]>;
  }
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const normalized = normalizeHost(host);

  // If host is already an IP address, validate directly
  if (ipaddr.isValid(normalized)) {
    return [validateIpAddress(normalized)];
  }

  const resolve4 = customResolver?.resolve4 || dns.resolve4.bind(dns);
  const resolve6 = customResolver?.resolve6 || dns.resolve6.bind(dns);

  const [v4Results, v6Results] = await Promise.allSettled([
    resolve4(normalized),
    resolve6(normalized),
  ]);

  const rawIps: string[] = [];

  if (v4Results.status === 'fulfilled' && Array.isArray(v4Results.value)) {
    rawIps.push(...v4Results.value);
  }
  if (v6Results.status === 'fulfilled' && Array.isArray(v6Results.value)) {
    rawIps.push(...v6Results.value);
  }

  if (rawIps.length === 0) {
    throw new SsrfBlockError(
      `DNS resolution returned no addresses for host: ${host}`,
      undefined,
      host
    );
  }

  const validatedList: Array<{ address: string; family: 4 | 6 }> = [];

  for (const rawIp of rawIps) {
    const validated = validateIpAddress(rawIp);
    validatedList.push(validated);
  }

  return validatedList;
}
