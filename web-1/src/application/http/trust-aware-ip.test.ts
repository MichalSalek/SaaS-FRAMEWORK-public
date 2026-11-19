/**
 * Unit tests — trust-aware client IP (trust-aware-ip.ts).
 *
 * Cases: one hop and many hops (TRUSTED_PROXY_DEPTH), a forged edge header without the edge proof,
 * the edge header with its proof, a direct hit on the origin (no edge headers), no IP at all, and
 * many different clients getting different keys. ENV_VARS is a hoisted mutable holder.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  envVars: { TRUSTED_EDGE: '' as string, TRUSTED_PROXY_DEPTH: '' as string },
}));

vi.mock('@app/environment/environment.config', () => ({ ENV_VARS: h.envVars }));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import {
  toRateLimitIpKey,
  resolveTrustedClientIp,
  resolveTrustedClientIpFromFetch,
  resetForwardingShapeNotesForTests,
} from '@app/http/trust-aware-ip';
import { reportIssueBackend } from '@app/debugger/error-handler';

const report = vi.mocked(reportIssueBackend);
const CF_RAY = 'a4eb72230936512f-WAW';
const RENDER_PEER = '10.0.0.7';

describe('trust-aware-ip', () => {
  beforeEach(() => {
    h.envVars.TRUSTED_EDGE = '';
    h.envVars.TRUSTED_PROXY_DEPTH = '';
    report.mockReset();
    resetForwardingShapeNotesForTests();
  });

  describe('unconfigured (secure default)', () => {
    it('ignores every forwarding header and anchors on the socket peer', () => {
      expect(
        resolveTrustedClientIp(
          {
            'x-forwarded-for': '203.0.113.9',
            'cf-connecting-ip': '203.0.113.8',
            'cf-ray': CF_RAY,
            'x-real-ip': '203.0.113.7',
          },
          '198.51.100.20'
        )
      ).toBe('198.51.100.20');
    });

    it('returns null when there is no socket peer and nothing is trusted', () => {
      expect(resolveTrustedClientIp({}, null)).toBeNull();
      expect(resolveTrustedClientIpFromFetch(new Headers())).toBeNull();
    });
  });

  describe('TRUSTED_PROXY_DEPTH (one hop, many hops)', () => {
    it('one trusted hop: takes the rightmost XFF entry', () => {
      h.envVars.TRUSTED_PROXY_DEPTH = '1';
      expect(
        resolveTrustedClientIp(
          { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' },
          RENDER_PEER
        )
      ).toBe('203.0.113.9');
    });

    it('two trusted hops: skips the inner proxy, ignores forged left entries', () => {
      h.envVars.TRUSTED_PROXY_DEPTH = '2';
      expect(
        resolveTrustedClientIp(
          {
            'x-forwarded-for': '6.6.6.6, 7.7.7.7, 203.0.113.9, 172.64.1.1',
          },
          RENDER_PEER
        )
      ).toBe('203.0.113.9');
    });

    it('a non-IP hop is not an identity: falls back to the socket peer', () => {
      h.envVars.TRUSTED_PROXY_DEPTH = '1';
      expect(
        resolveTrustedClientIp({ 'x-forwarded-for': 'unknown' }, RENDER_PEER)
      ).toBe(RENDER_PEER);
    });
  });

  describe('TRUSTED_EDGE=cloudflare', () => {
    beforeEach(() => {
      h.envVars.TRUSTED_EDGE = 'cloudflare';
    });

    it('trusts cf-connecting-ip when the request carries a real cf-ray', () => {
      expect(
        resolveTrustedClientIp(
          {
            'cf-connecting-ip': '203.0.113.9',
            'cf-ray': CF_RAY,
            'x-forwarded-for': '203.0.113.9, 172.64.1.1',
          },
          RENDER_PEER
        )
      ).toBe('203.0.113.9');
    });

    it('a forged cf-connecting-ip WITHOUT the edge proof is ignored', () => {
      expect(
        resolveTrustedClientIp(
          { 'cf-connecting-ip': '203.0.113.66' },
          RENDER_PEER
        )
      ).toBe(RENDER_PEER);
    });

    it('a forged cf-connecting-ip with a malformed cf-ray is ignored', () => {
      expect(
        resolveTrustedClientIp(
          { 'cf-connecting-ip': '203.0.113.66', 'cf-ray': 'anything' },
          RENDER_PEER
        )
      ).toBe(RENDER_PEER);
    });

    it('a garbage edge value never becomes a bucket key', () => {
      expect(
        resolveTrustedClientIp(
          { 'cf-connecting-ip': 'not-an-ip', 'cf-ray': CF_RAY },
          RENDER_PEER
        )
      ).toBe(RENDER_PEER);
    });

    it('a direct hit on the origin (no edge headers) anchors on the socket peer', () => {
      expect(
        resolveTrustedClientIp(
          { 'x-forwarded-for': '203.0.113.66' },
          RENDER_PEER
        )
      ).toBe(RENDER_PEER);
    });

    it('many clients behind the edge get many different keys; XFF spoofing does not move them', () => {
      const keys = new Set(
        Array.from({ length: 50 }, (_, i) =>
          resolveTrustedClientIpFromFetch(
            new Headers({
              'cf-connecting-ip': `203.0.113.${i + 1}`,
              'cf-ray': CF_RAY,
              'x-forwarded-for': `9.9.9.${i}, 203.0.113.${i + 1}`,
            })
          )
        )
      );
      expect(keys.size).toBe(50);
      const spoofed = resolveTrustedClientIpFromFetch(
        new Headers({
          'cf-connecting-ip': '203.0.113.1',
          'cf-ray': CF_RAY,
          'x-forwarded-for': '1.2.3.4',
        })
      );
      expect(spoofed).toBe('203.0.113.1');
    });

    it('canonicalizes IPv6 and IPv4-mapped values', () => {
      expect(
        resolveTrustedClientIpFromFetch(
          new Headers({ 'cf-connecting-ip': '2001:DB8::1', 'cf-ray': CF_RAY })
        )
      ).toBe('2001:db8::1');
      expect(resolveTrustedClientIp({}, '::ffff:198.51.100.4')).toBe(
        '198.51.100.4'
      );
    });

    it('logs the header shape once per process, with no address in it', () => {
      resolveTrustedClientIp(
        {
          'cf-connecting-ip': '203.0.113.9',
          'cf-ray': CF_RAY,
          'x-forwarded-for': '203.0.113.9, 172.64.1.1',
        },
        RENDER_PEER
      );
      resolveTrustedClientIp(
        { 'cf-connecting-ip': '203.0.113.10', 'cf-ray': CF_RAY },
        RENDER_PEER
      );
      expect(report).toHaveBeenCalledTimes(1);
      const payload = report.mock.calls[0]?.[0].payload;
      expect(payload).toEqual({
        edge: 'cloudflare',
        edgeProof: true,
        edgeIp: 'v4',
        xffHops: 2,
        edgeIpInXff: true,
        xRealIp: false,
      });
      expect(JSON.stringify(payload)).not.toContain('203.0.113');
    });
  });

  describe('toRateLimitIpKey', () => {
    it('keeps IPv4 as is', () => {
      expect(toRateLimitIpKey('203.0.113.9')).toBe('203.0.113.9');
    });

    it.each([
      ['2001:db8:aa:bb::1', '2001:db8:aa:bb::/64'],
      ['2001:db8:aa:bb:1:2:3:4', '2001:db8:aa:bb::/64'],
      ['2001:0db8:00aa:00bb:ffff::9', '2001:db8:aa:bb::/64'],
      ['2001:db8::1', '2001:db8:0:0::/64'],
      ['::1', '0:0:0:0::/64'],
      ['64:ff9b::198.51.100.4', '64:ff9b:0:0::/64'],
    ])('collapses %s to its /64', (ip, key) => {
      expect(toRateLimitIpKey(ip)).toBe(key);
    });

    it('two addresses of one /64 share a key, neighbouring /64s do not', () => {
      expect(toRateLimitIpKey('2001:db8:1:2::a')).toBe(
        toRateLimitIpKey('2001:db8:1:2:ffff:ffff:ffff:ffff')
      );
      expect(toRateLimitIpKey('2001:db8:1:2::a')).not.toBe(
        toRateLimitIpKey('2001:db8:1:3::a')
      );
    });
  });
});
