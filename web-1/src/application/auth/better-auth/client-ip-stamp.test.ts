/**
 * Unit tests: the IP stamp Better Auth keys on (client-ip-stamp.ts).
 *
 * Proves, against the INSTALLED Better Auth `getIP`: with the old default configuration a
 * multi-hop chain resolved to null (everyone shared the `no-trusted-ip` bucket); with the stamp
 * two clients get two buckets, and a client cannot choose its own bucket by sending the stamp
 * header or a forged edge header.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IncomingHttpHeaders } from 'node:http';

const h = vi.hoisted(() => ({
  envVars: { TRUSTED_EDGE: 'cloudflare', TRUSTED_PROXY_DEPTH: '' },
}));

vi.mock('@app/environment/environment.config', () => ({ ENV_VARS: h.envVars }));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import { getIP } from 'better-auth/api';
import { getIPFromHeader } from '@better-auth/core/utils/ip';
import {
  TRUSTED_CLIENT_IP_HEADER,
  readStampedClientIp,
  stampTrustedClientIp,
} from './client-ip-stamp';

const CF_RAY = 'a4eb72230936512f-WAW';
const RENDER_PEER = '10.0.0.7';
const BA_OPTIONS = {
  advanced: { ipAddress: { ipAddressHeaders: [TRUSTED_CLIENT_IP_HEADER] } },
};

const requestFrom = (headers: IncomingHttpHeaders) => ({
  headers: { ...headers },
  socket: { remoteAddress: RENDER_PEER },
});

const toFetchHeaders = (headers: IncomingHttpHeaders): Headers => {
  const out = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      out.set(name, value);
    }
  }
  return out;
};

describe('client-ip-stamp', () => {
  beforeEach(() => {
    h.envVars.TRUSTED_EDGE = 'cloudflare';
  });

  it('before the fix: Better Auth default reading of a multi-hop XFF gives no IP', () => {
    // getIP's own parser for its default header (`x-forwarded-for`); outside tests getIP returns
    // that null and the rate limiter keys everyone on the shared `no-trusted-ip` bucket.
    expect(getIPFromHeader('203.0.113.9, 172.64.1.1')).toBeNull();
  });

  it('stamps the trust-aware IP and Better Auth reads it: two clients, two buckets', () => {
    const a = requestFrom({
      'cf-connecting-ip': '203.0.113.9',
      'cf-ray': CF_RAY,
      'x-forwarded-for': '203.0.113.9, 172.64.1.1',
    });
    const b = requestFrom({
      'cf-connecting-ip': '198.51.100.4',
      'cf-ray': CF_RAY,
      'x-forwarded-for': '198.51.100.4, 172.64.1.1',
    });
    expect(stampTrustedClientIp(a)).toBe('203.0.113.9');
    expect(stampTrustedClientIp(b)).toBe('198.51.100.4');
    const ipA = getIP(toFetchHeaders(a.headers), BA_OPTIONS);
    const ipB = getIP(toFetchHeaders(b.headers), BA_OPTIONS);
    expect(ipA).toBe('203.0.113.9');
    expect(ipB).toBe('198.51.100.4');
    expect(ipA).not.toBe(ipB);
  });

  it('a client-sent stamp header is overwritten by the resolved IP', () => {
    const req = requestFrom({
      [TRUSTED_CLIENT_IP_HEADER]: '1.1.1.1',
      'cf-connecting-ip': '203.0.113.9',
      'cf-ray': CF_RAY,
    });
    stampTrustedClientIp(req);
    expect(req.headers[TRUSTED_CLIENT_IP_HEADER]).toBe('203.0.113.9');
  });

  it('a forged edge header without proof does not choose the bucket', () => {
    const req = requestFrom({
      [TRUSTED_CLIENT_IP_HEADER]: '1.1.1.1',
      'cf-connecting-ip': '203.0.113.66',
    });
    expect(stampTrustedClientIp(req)).toBe(RENDER_PEER);
    expect(readStampedClientIp(toFetchHeaders(req.headers))).toBe(RENDER_PEER);
  });

  it('removes a client-sent stamp when no IP resolves at all', () => {
    const req = {
      headers: { [TRUSTED_CLIENT_IP_HEADER]: '1.1.1.1' } as IncomingHttpHeaders,
    };
    expect(stampTrustedClientIp(req)).toBeNull();
    expect(req.headers[TRUSTED_CLIENT_IP_HEADER]).toBeUndefined();
    expect(readStampedClientIp(toFetchHeaders(req.headers))).toBeNull();
  });
});
