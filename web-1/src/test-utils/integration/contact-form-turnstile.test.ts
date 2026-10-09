/**
 * Integration-handler test — POST /api/v1/public/contact-form (Turnstile gate).
 *
 * Drives the REAL handler through the production middleware (validation, envelope,
 * error-mapper) via mockApiHandler. Three seams are mocked:
 *   - `ENV_VARS` (spread of the real config + a live getter for TURNSTILE_SECRET_KEY)
 *     so each test flips the feature-flag BY PRESENCE, per the env-driven test pattern
 *     (newsletter-audience.test.ts / email-dev-sink.test.ts);
 *   - `verifyTurnstileToken` (no network) — `isTurnstileEnabled` stays REAL, so the
 *     presence gate itself is under test;
 *   - `submitContactForm_IO` — the "zero emails on captcha fail" contract is asserted
 *     as "the operation is NEVER reached", without exercising the email transport.
 *
 * Contract pinned:
 *   - secret ABSENT  → token-less submission passes (back-compat, dev/staging);
 *   - secret PRESENT + no token          → 403 CAPTCHA_VERIFICATION_FAILED, no verify, no submit;
 *   - secret PRESENT + negative verdict  → 403 CAPTCHA_VERIFICATION_FAILED, no submit;
 *   - secret PRESENT + positive verdict  → 200 CONTACT_FORM_SUBMITTED, submit runs;
 *   - oversized turnstile_token          → 400 VALIDATION_FAILED (zod shape gate, before verify).
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

vi.mock('@domain/contact/operations/contact-form.operations', () => ({
  submitContactForm_IO: h.submit,
}));

import handler from '../../pages/api/v1/public/contact-form/index';

const VALID_BODY = {
  name: 'Anna Testowa',
  topic: 'bug',
  email: 'anna@example.com',
  message: 'To jest prawdziwa wiadomosc testowa.',
};

const TOKEN = 'turnstile-dummy-widget-token';

describe('POST /api/v1/public/contact-form — Turnstile gate', () => {
  beforeEach(() => {
    h.state.turnstileSecret = '';
    h.verify.mockReset().mockResolvedValue({ ok: true, reason: 'verified' });
    h.submit.mockReset().mockResolvedValue(success({ submitted: true }));
  });

  // ── Feature-flag OFF (secret absent — dev/staging back-compat) ─────────────

  it('passes WITHOUT a token when the secret is absent (verification disabled)', async () => {
    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: { ...VALID_BODY },
    });

    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.INFO.PUBLIC.CONTACT_FORM_SUBMITTED);
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
    expect(event).toBe(APP_EVENTS.INFO.PUBLIC.CONTACT_FORM_SUBMITTED);
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
