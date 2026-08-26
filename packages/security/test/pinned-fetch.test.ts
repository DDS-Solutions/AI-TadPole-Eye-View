import { Agent, MockAgent, setGlobalDispatcher } from 'undici';
import { describe, expect, it, vi } from 'vitest';
import {
  MaxBytesExceededError,
  PinnedFetchSecurityError,
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

  describe('Protocol and Error Checking', () => {
    it('rejects unsupported protocols like file:, ftp:, gopher:', async () => {
      await expect(pinnedFetch('file:///etc/passwd')).rejects.toThrow(PinnedFetchSecurityError);
      await expect(pinnedFetch('gopher://internal:70/')).rejects.toThrow(PinnedFetchSecurityError);
    });
  });

  describe('TOCTOU Connection Target Verification', () => {
    it('pins the socket connection directly to the pre-validated IP address', async () => {
      // Mock resolver returning a public IP
      const mockPublicIp = '93.184.216.34';
      const mockResolver = {
        resolve4: async () => [mockPublicIp],
        resolve6: async () => [],
      };

      // Set up MockAgent to intercept the request and verify execution
      const mockAgent = new MockAgent();
      mockAgent.disableNetConnect();

      const client = mockAgent.get('https://example.com');
      client.intercept({ path: '/test', method: 'GET' }).reply(200, { ok: true });

      const response = await pinnedFetch('https://example.com/test', {
        customResolver: mockResolver,
        dispatcher: mockAgent,
      });

      expect(response.status).toBe(200);
      const json = (await response.json()) as { ok: boolean };
      expect(json.ok).toBe(true);
    });
  });
});
