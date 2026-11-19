/**
 * POST newsletter-subscribe through the real middleware. ENV_VARS flips Turnstile
 * by presence, verifyTurnstileToken is mocked, and newsletterSubscribe_IO must
 * not run when the captcha fails. An absent secret allows a token-less body. A
 * present secret requires a positive verdict (200) or returns 403. An oversized
 * token is 400 before verify.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as EnvironmentConfigModule from '@app/environment/environment.config';
import type * as TurnstileVerifyModule from '@app/security/turnstile.verify';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { success } from '@kernel/application/result.types';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { mockApiHandler } from '../mockApiHandler';

const h = vi.hoisted(() => ({
  state: { turnstileSecret: '' as string },
  verify: vi.fn(),
  submit: vi.fn(),
}));

vi.mock('@app/environment/environment.config', async importOriginal => {
  const actual = await importOriginal<typeof EnvironmentConfigModule>();
  return {
    ENV_VARS: {
      ...actual.ENV_VARS,
      // Live getter — each test mutates h.state, the lazy reads in
      // turnstile.verify.ts (isTurnstileEnabled) observe it per-call.
      get TURNSTILE_SECRET_KEY() {
        return h.state.turnstileSecret;
      },
    },
  };
});

vi.mock('@app/security/turnstile.verify', async importOriginal => {
  const actual = await importOriginal<typeof TurnstileVerifyModule>();
  // Keep isTurnstileEnabled REAL (it reads the mocked ENV_VARS getter above);
  // only the network call is replaced.
  return { ...actual, verifyTurnstileToken: h.verify };
});

vi.mock(
  '@domain/newsletter/operations/newsletter-subscribe.operations',
  () => ({
    newsletterSubscribe_IO: h.submit,
  })
);

import handler from '../../pages/api/v1/public/newsletter-subscribe/index';

const VALID_BODY = { email: 'anna@example.com', consentSource: 'footer' };

const TOKEN = 'turnstile-dummy-widget-token';

describe('POST /api/v1/public/newsletter-subscribe — Turnstile gate', () => {
  beforeEach(() => {
    h.state.turnstileSecret = '';
    h.verify.mockReset().mockResolvedValue({ ok: true, reason: 'verified' });
    h.submit
      .mockReset()
      .mockResolvedValue(
        success({ subscribed: true, pending_confirmation: true })
      );
  });

  // ── Feature-flag OFF (secret absent — dev/staging back-compat) ─────────────

  it('passes WITHOUT a token when the secret is absent (verification disabled)', async () => {
    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: { ...VALID_BODY },
    });

    expect(status).toBe(200);
    expect(event).toBe(
      APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_PENDING_CONFIRMATION
    );
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  // ── Feature-flag ON (secret present) ────────────────────────────────────────

  it('rejects 403 CAPTCHA_VERIFICATION_FAILED when the secret is present and the token is missing — submit NEVER reached', async () => {
    h.state.turnstileSecret = 'live-secret';

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: { ...VALID_BODY },
    });

    expect(status).toBe(403);
    expect(event).toBe(APP_EVENTS.INFO.PUBLIC.CAPTCHA_VERIFICATION_FAILED);
    // Hard server-side gate: no token ⇒ no siteverify roundtrip, no admin email.
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });

  it('rejects 403 on a NEGATIVE verify verdict — submit NEVER reached (zero emails)', async () => {
    h.state.turnstileSecret = 'live-secret';
    h.verify.mockResolvedValue({ ok: false, reason: 'invalid-input-response' });

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: { ...VALID_BODY, turnstile_token: TOKEN },
    });

    expect(status).toBe(403);
    expect(event).toBe(APP_EVENTS.INFO.PUBLIC.CAPTCHA_VERIFICATION_FAILED);
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.submit).not.toHaveBeenCalled();
  });

  it('accepts a valid submission on a POSITIVE verdict and passes token + trust-aware IP to verify', async () => {
    h.state.turnstileSecret = 'live-secret';

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: { ...VALID_BODY, turnstile_token: TOKEN },
    });

    expect(status).toBe(200);
    expect(event).toBe(
      APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_PENDING_CONFIRMATION
    );
    expect(h.verify).toHaveBeenCalledTimes(1);
    // node-mocks-http: no forwarding headers + no socket peer ⇒ trust-aware
    // resolver anchors to null (secure-by-default unconfigured mode).
    expect(h.verify).toHaveBeenCalledWith({ token: TOKEN, remoteIp: null });
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  // ── Validator shape gate (runs BEFORE the handler / verify) ────────────────

  it('rejects 400 VALIDATION_FAILED for an oversized turnstile_token (zod cap) — before any verify', async () => {
    h.state.turnstileSecret = 'live-secret';

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: {
        ...VALID_BODY,
        turnstile_token: 'x'.repeat(VALIDATION_LENGTHS.TURNSTILE_TOKEN_MAX + 1),
      },
    });

    expect(status).toBe(400);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });
});
