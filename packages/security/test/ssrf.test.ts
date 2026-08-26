import { describe, expect, it } from 'vitest';
import {
  SsrfBlockError,
  normalizeHost,
  resolveAndValidateHost,
  validateIpAddress,
} from '../src/ssrf.js';

describe('SSRF Protection Suite', () => {
  describe('normalizeHost (P7)', () => {
    it('normalizes integer encoded IPv4 addresses', () => {
      expect(normalizeHost('2130706433')).toBe('127.0.0.1');
      expect(normalizeHost('3232235521')).toBe('192.168.0.1');
    });

    it('normalizes hex and octal formatted IPs', () => {
      expect(normalizeHost('0x7f.0.0.1')).toBe('127.0.0.1');
      expect(normalizeHost('0177.0.0.1')).toBe('127.0.0.1');
    });

    it('normalizes short-form dotted IPv4 addresses (127.1 -> 127.0.0.1, 127.0.1 -> 127.0.0.1)', () => {
      expect(normalizeHost('127.1')).toBe('127.0.0.1');
      expect(normalizeHost('127.0.1')).toBe('127.0.0.1');
      expect(normalizeHost('10.1')).toBe('10.0.0.1');
      expect(normalizeHost('192.168.1')).toBe('192.168.0.1');
    });

    it('strips trailing dot from FQDN hostnames', () => {
      expect(normalizeHost('example.com.')).toBe('example.com');
      expect(normalizeHost('opensky-network.org.')).toBe('opensky-network.org');
    });

    it('strips bracket notation from IPv6 hosts', () => {
      expect(normalizeHost('[::1]')).toBe('::1');
      expect(normalizeHost('[2606:4700:4700::1111]')).toBe('2606:4700:4700::1111');
    });
  });

  describe('validateIpAddress - IPv4 & Special Ranges', () => {
    it('blocks loopback (127.0.0.0/8) including normalized short-forms', () => {
      expect(() => validateIpAddress('127.0.0.1')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('127.255.255.254')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress(normalizeHost('127.1'))).toThrow(SsrfBlockError);
      expect(() => validateIpAddress(normalizeHost('127.0.1'))).toThrow(SsrfBlockError);
    });

    it('blocks private RFC1918 ranges', () => {
      expect(() => validateIpAddress('10.0.0.1')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('172.16.0.1')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('172.31.255.255')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('192.168.1.1')).toThrow(SsrfBlockError);
    });

    it('blocks CGNAT space (100.64.0.0/10)', () => {
      expect(() => validateIpAddress('100.64.0.1')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('100.127.255.255')).toThrow(SsrfBlockError);
    });

    it('blocks benchmarking (198.18.0.0/15) and 6to4 relay (192.88.99.0/24)', () => {
      expect(() => validateIpAddress('198.18.0.1')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('198.19.255.255')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('192.88.99.1')).toThrow(SsrfBlockError);
    });

    it('blocks unspecified, link-local, broadcast and reserved (0/8, 169.254/16, 240/4)', () => {
      expect(() => validateIpAddress('0.0.0.0')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('169.254.169.254')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('240.0.0.1')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('255.255.255.255')).toThrow(SsrfBlockError);
    });

    it('allows valid public IPv4 addresses', () => {
      const public1 = validateIpAddress('8.8.8.8');
      expect(public1.address).toBe('8.8.8.8');
      expect(public1.family).toBe(4);

      const public2 = validateIpAddress('93.184.216.34');
      expect(public2.address).toBe('93.184.216.34');
    });
  });

  describe('validateIpAddress - IPv6 & Unwrapping', () => {
    it('unwraps and blocks IPv4-mapped IPv6 loopback and private IPs', () => {
      expect(() => validateIpAddress('::ffff:127.0.0.1')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('::ffff:10.0.0.1')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('::ffff:192.168.1.50')).toThrow(SsrfBlockError);
    });

    it('unwraps and blocks NAT64 embedded private IPs (64:ff9b::/96)', () => {
      expect(() => validateIpAddress('64:ff9b::127.0.0.1')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('64:ff9b::10.0.0.1')).toThrow(SsrfBlockError);
    });

    it('blocks non-global IPv6 (loopback, link-local, ULA, documentation)', () => {
      expect(() => validateIpAddress('::1')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('fe80::1')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('fc00::1')).toThrow(SsrfBlockError);
      expect(() => validateIpAddress('2001:db8::1')).toThrow(SsrfBlockError);
    });

    it('allows valid global unicast IPv6 (2000::/3)', () => {
      const v6 = validateIpAddress('2606:4700:4700::1111');
      expect(v6.family).toBe(6);
    });
  });

  describe('resolveAndValidateHost with DNS mocking', () => {
    it('blocks hostnames that resolve to private IP addresses', async () => {
      const mockResolver = {
        resolve4: async () => ['127.0.0.1'],
        resolve6: async () => [],
      };

      await expect(
        resolveAndValidateHost('malicious.internal.local', mockResolver)
      ).rejects.toThrow(SsrfBlockError);
    });

    it('allows hostnames that resolve strictly to public IP addresses', async () => {
      const mockResolver = {
        resolve4: async () => ['93.184.216.34'],
        resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
      };

      const result = await resolveAndValidateHost('example.com', mockResolver);
      expect(result.length).toBe(2);
      expect(result[0]?.address).toBe('93.184.216.34');
    });

    it('handles trailing-dot FQDN resolution cleanly', async () => {
      const mockResolver = {
        resolve4: async () => ['93.184.216.34'],
        resolve6: async () => [],
      };

      const result = await resolveAndValidateHost('example.com.', mockResolver);
      expect(result.length).toBe(1);
      expect(result[0]?.address).toBe('93.184.216.34');
    });
  });
});
