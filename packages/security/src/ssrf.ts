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
 * Validates request destination against host and path allowlists with segment-aware path matching.
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
    const isPathAllowed = allowedPaths.some((rule) => {
      if (rule.host.toLowerCase() !== host) {
        return false;
      }
      const prefix =
        rule.pathPrefix.endsWith('/') && rule.pathPrefix !== '/'
          ? rule.pathPrefix.slice(0, -1)
          : rule.pathPrefix;
      return path === prefix || path.startsWith(prefix === '/' ? '/' : `${prefix}/`);
    });
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
 * Normalizes encoded URL hostnames (e.g. integer IP 2130706433, hex 0x7f.1, octal 0177.0.0.1, short-form 127.1, trailing dot host.).
 */
export function normalizeHost(host: string): string {
  let cleanHost = host.trim().toLowerCase();

  // Strip enclosing brackets for IPv6
  if (cleanHost.startsWith('[') && cleanHost.endsWith(']')) {
    cleanHost = cleanHost.slice(1, -1);
  }

  // Strip single trailing dot for FQDN (e.g. 'example.com.')
  if (cleanHost.endsWith('.') && cleanHost.length > 1) {
    cleanHost = cleanHost.slice(0, -1);
  }

  // Pure integer decimal IP (e.g. 2130706433 -> 127.0.0.1)
  if (/^\d+$/.test(cleanHost)) {
    const num = Number.parseInt(cleanHost, 10);
    if (num >= 0 && num <= 0xffffffff) {
      return [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join('.');
    }
  }

  // Dotted segments containing decimal, hex, or octal numbers (e.g. 0x7f.0.0.1, 0177.0.0.1, 127.1, 127.0.1)
  if (/^[0-9a-fx.]+/i.test(cleanHost) && cleanHost.includes('.')) {
    const parts = cleanHost.split('.');
    if (
      (parts.length === 2 || parts.length === 3 || parts.length === 4) &&
      parts.every((p) => /^(0x[0-9a-f]+|0[0-7]*|[1-9]\d*|0)$/i.test(p))
    ) {
      try {
        const nums = parts.map((p) => {
          if (p.startsWith('0x') || p.startsWith('0X')) {
            return Number.parseInt(p, 16);
          }
          if (p.startsWith('0') && p.length > 1) {
            return Number.parseInt(p, 8);
          }
          return Number.parseInt(p, 10);
        });

        if (nums.every((n) => typeof n === 'number' && !Number.isNaN(n) && n >= 0)) {
          const n0 = nums[0];
          const n1 = nums[1];
          const n2 = nums[2];
          const n3 = nums[3];

          if (
            nums.length === 4 &&
            n0 !== undefined &&
            n1 !== undefined &&
            n2 !== undefined &&
            n3 !== undefined &&
            n0 <= 255 &&
            n1 <= 255 &&
            n2 <= 255 &&
            n3 <= 255
          ) {
            return `${n0}.${n1}.${n2}.${n3}`;
          }

          if (
            nums.length === 2 &&
            n0 !== undefined &&
            n1 !== undefined &&
            n0 <= 255 &&
            n1 <= 0xffffff
          ) {
            return [n0, (n1 >>> 16) & 255, (n1 >>> 8) & 255, n1 & 255].join('.');
          }

          if (
            nums.length === 3 &&
            n0 !== undefined &&
            n1 !== undefined &&
            n2 !== undefined &&
            n0 <= 255 &&
            n1 <= 255 &&
            n2 <= 0xffff
          ) {
            return [n0, n1, (n2 >>> 8) & 255, n2 & 255].join('.');
          }
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

export interface ResolverOverride {
  resolve4?: (hostname: string) => Promise<string[]>;
  resolve6?: (hostname: string) => Promise<string[]>;
}

/**
 * Resolves a hostname to IP addresses and validates all returned records against SSRF rules.
 * All resolved IPs must pass validation, otherwise an error is thrown.
 */
export async function resolveAndValidateHost(
  hostname: string,
  resolverOverride?: ResolverOverride
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const normHost = normalizeHost(hostname);

  // If already an IP address, validate directly
  if (ipaddr.isValid(normHost)) {
    const validated = validateIpAddress(normHost);
    return [validated];
  }

  const resolve4 = resolverOverride?.resolve4 ?? dns.resolve4;
  const resolve6 = resolverOverride?.resolve6 ?? dns.resolve6;

  const [v4Results, v6Results] = await Promise.allSettled([resolve4(normHost), resolve6(normHost)]);

  const allAddresses: Array<{ address: string; family: 4 | 6 }> = [];

  if (v4Results.status === 'fulfilled' && Array.isArray(v4Results.value)) {
    for (const ip of v4Results.value) {
      allAddresses.push({ address: ip, family: 4 });
    }
  }

  if (v6Results.status === 'fulfilled' && Array.isArray(v6Results.value)) {
    for (const ip of v6Results.value) {
      allAddresses.push({ address: ip, family: 6 });
    }
  }

  if (allAddresses.length === 0) {
    throw new SsrfBlockError(
      `DNS resolution failed or returned no addresses for ${hostname}`,
      undefined,
      hostname
    );
  }

  // Validate ALL resolved IP addresses (Rule 4: fail-closed if ANY resolved IP is malicious)
  const validatedAddresses: Array<{ address: string; family: 4 | 6 }> = [];
  for (const record of allAddresses) {
    const validated = validateIpAddress(record.address);
    validatedAddresses.push(validated);
  }

  return validatedAddresses;
}
