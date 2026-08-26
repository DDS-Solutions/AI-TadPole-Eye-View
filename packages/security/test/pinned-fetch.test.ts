import { MockAgent } from 'undici';
import { describe, expect, it } from 'vitest';
import {
  MaxBytesExceededError,
  PinnedFetchSecurityError,
  createPinnedAgent,
  createPinnedLookupHook,
  pinnedFetch,
  validateAllowlists,
} from '../src/pinned-fetch.js';

describe('Pinned Fetch Client', () => {
  describe('validateAllowlists', () => {
    it('allows permitted hosts and rejects unauthorized hosts', () => {
      const allowedUrl = new URL('https://opensky-network.org/api/states/all');
      expect(() => {
        validateAllowlists(allowedUrl, ['opensky-network.org', 'api.adsb.lol']);
      }).not.toThrow();

      const forbiddenUrl = new URL('https://evil-site.com/data');
      expect(() => {
        validateAllowlists(forbiddenUrl, ['opensky-network.org']);
      }).toThrow(PinnedFetchSecurityError);
    });

    it('validates allowed paths per host prefix with segment awareness', () => {
      const pathRules = [{ host: 'radio-browser.info', pathPrefix: '/json/stations' }];

      const validUrl = new URL('https://radio-browser.info/json/stations/byname/jazz');
      expect(() => {
        validateAllowlists(validUrl, undefined, pathRules);
      }).not.toThrow();

      const exactUrl = new URL('https://radio-browser.info/json/stations');
      expect(() => {
        validateAllowlists(exactUrl, undefined, pathRules);
      }).not.toThrow();

      // Suffix without path segment separator should be rejected
      const prefixBypassUrl = new URL('https://radio-browser.info/json/stations_unauthorized');
      expect(() => {
        validateAllowlists(prefixBypassUrl, undefined, pathRules);
      }).toThrow(PinnedFetchSecurityError);

      const invalidPathUrl = new URL('https://radio-browser.info/admin/delete');
      expect(() => {
        validateAllowlists(invalidPathUrl, undefined, pathRules);
      }).toThrow(PinnedFetchSecurityError);
    });
  });

  describe('Protocol and Userinfo Security Checking', () => {
    it('rejects unsupported protocols like file:, ftp:, gopher:', async () => {
      await expect(pinnedFetch('file:///etc/passwd')).rejects.toThrow(PinnedFetchSecurityError);
      await expect(pinnedFetch('gopher://internal:70/')).rejects.toThrow(PinnedFetchSecurityError);
    });

    it('rejects URLs with embedded credentials (userinfo)', async () => {
      await expect(pinnedFetch('https://user:password@example.com/data')).rejects.toThrow(
        PinnedFetchSecurityError
      );
      await expect(pinnedFetch('https://admin@example.com/data')).rejects.toThrow(
        PinnedFetchSecurityError
      );
    });
  });

  describe('createPinnedAgent & Lookup Hook Pinning (P3)', () => {
    it('forces DNS resolution lookup hook to return pre-validated IP regardless of hostname requested', () => {
      const pinnedIp = { address: '93.184.216.34', family: 4 };
      const lookupHook = createPinnedLookupHook(pinnedIp);

      let resolvedAddresses: Array<{ address: string; family: number }> | undefined;
      lookupHook(
        'malicious-rebind.internal.local',
        {},
        (_err: Error | null, addresses: Array<{ address: string; family: number }>) => {
          resolvedAddresses = addresses;
        }
      );

      expect(resolvedAddresses).toEqual([{ address: '93.184.216.34', family: 4 }]);

      const agent = createPinnedAgent(pinnedIp);
      expect(agent).toBeDefined();
    });
  });

  describe('Response Byte Caps & Streaming Enforcement (P1)', () => {
    it('rejects responses exceeding Content-Length header fast-path', async () => {
      const mockResolver = {
        resolve4: async () => ['93.184.216.34'],
        resolve6: async () => [],
      };

      const mockAgent = new MockAgent();
      mockAgent.disableNetConnect();
      const client = mockAgent.get('https://example.com');
      client.intercept({ path: '/large-header', method: 'GET' }).reply(200, 'some data', {
        headers: { 'content-length': '10485760' }, // 10MB
      });

      await expect(
        pinnedFetch('https://example.com/large-header', {
          customResolver: mockResolver,
          dispatcher: mockAgent,
          maxBytes: 1024, // 1KB limit
        })
      ).rejects.toThrow(MaxBytesExceededError);
    });

    it('enforces streaming byte caps on chunked responses without Content-Length', async () => {
      const mockResolver = {
        resolve4: async () => ['93.184.216.34'],
        resolve6: async () => [],
      };

      const mockAgent = new MockAgent();
      mockAgent.disableNetConnect();
      const client = mockAgent.get('https://example.com');

      // 5KB payload with no content-length header
      const largeChunk = 'A'.repeat(5120);
      client.intercept({ path: '/chunked-overflow', method: 'GET' }).reply(200, largeChunk);

      const response = await pinnedFetch('https://example.com/chunked-overflow', {
        customResolver: mockResolver,
        dispatcher: mockAgent,
        maxBytes: 1024, // 1KB cap
      });

      // Reading the body triggers the counting TransformStream and throws MaxBytesExceededError
      await expect(response.text()).rejects.toThrow(MaxBytesExceededError);
    });

    it('allows chunked responses within byte caps to pass intact', async () => {
      const mockResolver = {
        resolve4: async () => ['93.184.216.34'],
        resolve6: async () => [],
      };

      const mockAgent = new MockAgent();
      mockAgent.disableNetConnect();
      const client = mockAgent.get('https://example.com');

      const validPayload = JSON.stringify({ status: 'ok', records: [1, 2, 3] });
      client.intercept({ path: '/chunked-valid', method: 'GET' }).reply(200, validPayload);

      const response = await pinnedFetch('https://example.com/chunked-valid', {
        customResolver: mockResolver,
        dispatcher: mockAgent,
        maxBytes: 10240, // 10KB cap
      });

      const text = await response.text();
      expect(text).toBe(validPayload);
    });
  });
});
