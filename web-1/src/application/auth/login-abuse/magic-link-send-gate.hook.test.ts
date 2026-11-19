/**
 * Unit tests — the Better Auth hook step of the magic-link throttle: path filter, header reading,
 * the HTTP shape of each refusal, and fail-open on an internal error.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ turnstileEnabled: true }));

vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: { BETTER_AUTH_SECRET: 'test-secret-for-throttle-keys' },
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('@app/db/db.client', () => ({ DB_CLIENT: {} }));
vi.mock('@app/security/turnstile.verify', () => ({
  isTurnstileEnabled: () => h.turnstileEnabled,
  verifyTurnstileToken: ({ token }: { token: string }) =>
    Promise.resolve(
      token === 'ok-token'
        ? { ok: true, reason: 'verified' }
        : { ok: false, reason: 'invalid-input-response' }
    ),
}));

import { APIError } from 'better-auth/api';
import { MAGIC_LINK_GATE_CODES } from '@kernel/application/auth/auth.config';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  createMemoryThrottleCounterStore,
  type ThrottleCounterStore,
} from '@app/security/throttle-counter.store';
import { TRUSTED_CLIENT_IP_HEADER } from '../better-auth/client-ip-stamp';
import { MAGIC_LINK_THROTTLE as T } from './login-abuse.config';
import { enforceMagicLinkSendGate } from './magic-link-send-gate.hook';

const ctxFor = (
  headers: Record<string, string> = {},
  email = 'a@example.com'
) => ({
  path: '/sign-in/magic-link',
  body: { email, callbackURL: '/app' },
  headers: new Headers({
    [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.9',
    ...headers,
  }),
});

const catchError = async (p: Promise<void>): Promise<APIError> => {
  try {
    await p;
  } catch (error) {
    if (error instanceof APIError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an APIError');
};

describe('enforceMagicLinkSendGate', () => {
  let store: ThrottleCounterStore;
  beforeEach(() => {
    h.turnstileEnabled = true;
    store = createMemoryThrottleCounterStore();
    vi.mocked(reportIssueBackend).mockReset();
  });

  it('ignores every path except the magic-link send (verify, OAuth, session)', async () => {
    for (const path of [
      '/magic-link/verify',
      '/sign-in/social',
      '/callback/google',
      '/get-session',
    ]) {
      await expect(
        enforceMagicLinkSendGate({ ...ctxFor(), path }, { store })
      ).resolves.toBeUndefined();
    }
    // Nothing was counted: the next send to the same address is still the first one.
    expect((await store.hit('probe', 1000, new Date())).count).toBe(1);
  });

  it('answers 428 TURNSTILE_REQUIRED over the free budget, then accepts the header token', async () => {
    for (let i = 0; i < T.EMAIL_FREE_SENDS_SHORT; i++) {
      await enforceMagicLinkSendGate(ctxFor(), { store });
    }
    const required = await catchError(
      enforceMagicLinkSendGate(ctxFor(), { store })
    );
    expect(required.statusCode).toBe(428);
    expect(required.body?.code).toBe(MAGIC_LINK_GATE_CODES.TURNSTILE_REQUIRED);

    const invalid = await catchError(
      enforceMagicLinkSendGate(
        ctxFor({ [CUSTOM_HEADERS.turnstileToken]: 'bad' }),
        { store }
      )
    );
    expect(invalid.statusCode).toBe(428);
    expect(invalid.body?.code).toBe(MAGIC_LINK_GATE_CODES.TURNSTILE_INVALID);

    await expect(
      enforceMagicLinkSendGate(
        ctxFor({ [CUSTOM_HEADERS.turnstileToken]: 'ok-token' }),
        { store }
      )
    ).resolves.toBeUndefined();
  });

  it('answers 429 with Retry-After on the hard pair cap', async () => {
    for (let i = 0; i < T.PAIR_MAX_SENDS; i++) {
      await enforceMagicLinkSendGate(
        ctxFor({ [CUSTOM_HEADERS.turnstileToken]: 'ok-token' }),
        { store }
      );
    }
    const limited = await catchError(
      enforceMagicLinkSendGate(
        ctxFor({ [CUSTOM_HEADERS.turnstileToken]: 'ok-token' }),
        { store }
      )
    );
    expect(limited.statusCode).toBe(429);
    expect(limited.body?.code).toBe(MAGIC_LINK_GATE_CODES.RATE_LIMITED);
    expect(new Headers(limited.headers).get('Retry-After')).toBe(
      String(T.SHORT_WINDOW_MS / 1000)
    );
  });

  it('a body without a string email is left to Better Auth validation', async () => {
    await expect(
      enforceMagicLinkSendGate({ ...ctxFor(), body: { email: 42 } }, { store })
    ).resolves.toBeUndefined();
  });

  it('lets the send through and reports when the gate itself fails', async () => {
    const broken: ThrottleCounterStore = {
      hit: () => Promise.reject(new Error('boom')),
    };
    await expect(
      enforceMagicLinkSendGate(ctxFor(), { store: broken })
    ).resolves.toBeUndefined();
    expect(vi.mocked(reportIssueBackend)).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'MAGIC_LINK_GATE', mode: 'error' })
    );
  });

  it('reports a degraded send when Turnstile is not configured', async () => {
    h.turnstileEnabled = false;
    for (let i = 0; i <= T.EMAIL_FREE_SENDS_SHORT; i++) {
      await enforceMagicLinkSendGate(ctxFor(), { store });
    }
    expect(vi.mocked(reportIssueBackend)).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'MAGIC_LINK_GATE', mode: 'warn' })
    );
  });
});
