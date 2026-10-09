/**
 * Unit tests — Cloudflare Turnstile server-side verification (turnstile.verify.ts).
 *
 * Verifies: feature-flag by presence (isTurnstileEnabled), the siteverify request
 * shape (form-encoded secret/response/remoteip, remoteip omitted when null), the
 * positive verdict, and EVERY fail-closed branch: negative CF verdict (no warn —
 * bot hot path must not flood the log), non-OK HTTP status, malformed JSON,
 * network error and timeout/abort (all → ok:false + reportIssueBackend 'warn').
 * `ENV_VARS` and `reportIssueBackend` are mocked via hoisted holders; `fetch` is
 * stubbed globally — no network.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  envVars: {
    TURNSTILE_SECRET_KEY: '' as string,
  },
}));

vi.mock('@app/environment/environment.config', () => ({ ENV_VARS: h.envVars }));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import {
  isTurnstileEnabled,
  verifyTurnstileToken,
} from '@app/security/turnstile.verify';
import { reportIssueBackend } from '@app/debugger/error-handler';

const report = vi.mocked(reportIssueBackend);
const SECRET = 'test-turnstile-secret';
const TOKEN = 'turnstile-dummy-widget-token';

const fetchMock = vi.fn();

/** CF siteverify JSON response helper. */
const siteverifyResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('turnstile.verify', () => {
  beforeEach(() => {
    h.envVars.TURNSTILE_SECRET_KEY = SECRET;
    report.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Feature-flag by presence ───────────────────────────────────────────────

  describe('isTurnstileEnabled', () => {
    it('is false when the secret is absent, true when present (lazy read)', () => {
      h.envVars.TURNSTILE_SECRET_KEY = '';
      expect(isTurnstileEnabled()).toBe(false);
      h.envVars.TURNSTILE_SECRET_KEY = SECRET;
      expect(isTurnstileEnabled()).toBe(true);
    });
  });

  // ── Request shape ──────────────────────────────────────────────────────────

  describe('siteverify request shape', () => {
    it('POSTs form-encoded secret/response/remoteip to the CF siteverify URL', async () => {
      fetchMock.mockResolvedValue(siteverifyResponse({ success: true }));

      await verifyTurnstileToken({ token: TOKEN, remoteIp: '203.0.113.7' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify'
      );
      expect(init.method).toBe('POST');
      const form = new URLSearchParams(String(init.body));
      expect(form.get('secret')).toBe(SECRET);
      expect(form.get('response')).toBe(TOKEN);
      expect(form.get('remoteip')).toBe('203.0.113.7');
    });

    it('omits remoteip entirely when the trust-aware IP is null', async () => {
      fetchMock.mockResolvedValue(siteverifyResponse({ success: true }));

      await verifyTurnstileToken({ token: TOKEN, remoteIp: null });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const form = new URLSearchParams(String(init.body));
      expect(form.has('remoteip')).toBe(false);
    });
  });

  // ── Verdicts ───────────────────────────────────────────────────────────────

  describe('verdicts', () => {
    it('returns ok:true on a positive CF verdict (no warn report)', async () => {
      fetchMock.mockResolvedValue(siteverifyResponse({ success: true }));

      const result = await verifyTurnstileToken({
        token: TOKEN,
        remoteIp: null,
      });

      expect(result).toEqual({ ok: true, reason: 'verified' });
      expect(report).not.toHaveBeenCalled();
    });

    it('returns ok:false with the CF error-codes on a negative verdict — WITHOUT a warn report (bot hot path)', async () => {
      fetchMock.mockResolvedValue(
        siteverifyResponse({
          success: false,
          'error-codes': ['invalid-input-response', 'timeout-or-duplicate'],
        })
      );

      const result = await verifyTurnstileToken({
        token: TOKEN,
        remoteIp: null,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('invalid-input-response,timeout-or-duplicate');
      expect(report).not.toHaveBeenCalled();
    });

    it('returns ok:false (no-error-code) when CF says success:false without codes', async () => {
      fetchMock.mockResolvedValue(siteverifyResponse({ success: false }));

      const result = await verifyTurnstileToken({
        token: TOKEN,
        remoteIp: null,
      });

      expect(result).toEqual({ ok: false, reason: 'no-error-code' });
    });
  });

  // ── Fail-closed branches (infra errors → ok:false + warn) ──────────────────

  describe('fail-closed on infrastructure errors', () => {
    it('fails closed on a CF 5xx (non-OK HTTP status) and reports a warn', async () => {
      fetchMock.mockResolvedValue(siteverifyResponse({}, 503));

      const result = await verifyTurnstileToken({
        token: TOKEN,
        remoteIp: null,
      });

      expect(result).toEqual({ ok: false, reason: 'siteverify-http-503' });
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0]?.[0]).toMatchObject({
        namespace: 'TURNSTILE_VERIFY',
        mode: 'warn',
      });
    });

    it('fails closed on malformed JSON and reports a warn', async () => {
      fetchMock.mockResolvedValue(new Response('not-json', { status: 200 }));

      const result = await verifyTurnstileToken({
        token: TOKEN,
        remoteIp: null,
      });

      expect(result).toEqual({
        ok: false,
        reason: 'siteverify-malformed-json',
      });
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0]?.[0]).toMatchObject({ mode: 'warn' });
    });

    it('fails closed on a network error (fetch rejects) and reports a warn', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const result = await verifyTurnstileToken({
        token: TOKEN,
        remoteIp: null,
      });

      expect(result).toEqual({ ok: false, reason: 'siteverify-network' });
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0]?.[0]).toMatchObject({ mode: 'warn' });
    });

    it('fails closed on timeout (AbortError) and reports a warn', async () => {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      fetchMock.mockRejectedValue(abortError);

      const result = await verifyTurnstileToken({
        token: TOKEN,
        remoteIp: null,
      });

      expect(result).toEqual({ ok: false, reason: 'siteverify-timeout' });
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0]?.[0]).toMatchObject({ mode: 'warn' });
    });

    it('aborts the request via AbortController after the 5s timeout (real timer wiring)', async () => {
      vi.useFakeTimers();
      try {
        // fetch that rejects with AbortError ONLY when its signal aborts —
        // proves the setTimeout→controller.abort() wiring, not just catch-mapping.
        fetchMock.mockImplementation(
          (_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => {
                const err = new Error('aborted');
                err.name = 'AbortError';
                reject(err);
              });
            })
        );

        const pending = verifyTurnstileToken({ token: TOKEN, remoteIp: null });
        await vi.advanceTimersByTimeAsync(5_000);
        const result = await pending;

        expect(result).toEqual({ ok: false, reason: 'siteverify-timeout' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('fails closed (defensively) when called with the secret unset', async () => {
      h.envVars.TURNSTILE_SECRET_KEY = '';

      const result = await verifyTurnstileToken({
        token: TOKEN,
        remoteIp: null,
      });

      expect(result).toEqual({ ok: false, reason: 'secret-not-configured' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
