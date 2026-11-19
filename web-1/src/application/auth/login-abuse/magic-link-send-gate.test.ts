/**
 * Unit tests: magic-link send throttle (magic-link-send-gate.ts).
 *
 * In-memory counter store and a fake clock; Turnstile is a stub. Covers: free budgets then
 * Turnstile, the hard pair cap with a truthful Retry-After, window renewal, normalization
 * bypasses, that nothing keyed on the mailbox ever refuses a solved Turnstile (no lockout), the
 * parallel-request race, IPv6 /64 keying, the degraded path and that the outcome never depends on
 * whether an account exists.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: {
    BETTER_AUTH_SECRET: 'test-secret-for-throttle-keys',
    TRUSTED_EDGE: '',
    TRUSTED_PROXY_DEPTH: '',
  },
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use(): never {
      throw new Error('the gate must not touch the database directly');
    },
  },
}));

import { createMemoryThrottleCounterStore } from '@app/security/throttle-counter.store';
import { MAGIC_LINK_THROTTLE as T } from './login-abuse.config';
import {
  evaluateMagicLinkSend,
  type MagicLinkSendGateDeps,
  type MagicLinkSendDecision,
} from './magic-link-send-gate';

const VICTIM = 'victim@example.com';
const IP_A = '203.0.113.9';
const IP_B = '198.51.100.4';
const ALLOW = { kind: 'allow', degraded: false } as const;
const MINUTE = 60_000;

let clock: number;
let deps: MagicLinkSendGateDeps & {
  verifyTurnstile: ReturnType<typeof vi.fn>;
};

const send = (
  email: string,
  ip: string | null,
  turnstileToken: string | null = null
): Promise<MagicLinkSendDecision> =>
  evaluateMagicLinkSend({ email, ip, turnstileToken }, deps);

const sendTimes = async (
  n: number,
  email: string,
  ip: string | null,
  token: string | null = 'ok-token'
) => {
  const out: MagicLinkSendDecision[] = [];
  for (let i = 0; i < n; i++) {
    out.push(await send(email, ip, token));
  }
  return out;
};

describe('evaluateMagicLinkSend', () => {
  beforeEach(() => {
    clock = Date.UTC(2026, 9, 22, 12, 0, 0);
    deps = {
      store: createMemoryThrottleCounterStore(),
      turnstileEnabled: () => true,
      verifyTurnstile: vi.fn(({ token }: { token: string }) =>
        Promise.resolve(
          token === 'ok-token'
            ? { ok: true, reason: 'verified' }
            : { ok: false, reason: 'invalid-input-response' }
        )
      ),
      now: () => new Date(clock),
    };
  });

  it('a normal login is never challenged: the free budget passes without Turnstile', async () => {
    for (let i = 0; i < T.EMAIL_FREE_SENDS_SHORT; i++) {
      expect(await send(VICTIM, IP_A)).toEqual(ALLOW);
    }
    expect(deps.verifyTurnstile).not.toHaveBeenCalled();
  });

  it('over the free budget: Turnstile required, a bad token refused, a good token passes', async () => {
    await sendTimes(T.EMAIL_FREE_SENDS_SHORT, VICTIM, IP_A, null);
    expect(await send(VICTIM, IP_A)).toEqual({ kind: 'turnstile-required' });
    expect(await send(VICTIM, IP_A, 'bad')).toEqual({
      kind: 'turnstile-invalid',
    });
    expect(await send(VICTIM, IP_A, 'ok-token')).toEqual(ALLOW);
    expect(deps.verifyTurnstile).toHaveBeenLastCalledWith({
      token: 'ok-token',
      remoteIp: IP_A,
    });
  });

  it('spelling variants share one budget (no normalization bypass)', async () => {
    const variants = [
      'victim@example.com',
      'VICTIM@example.com',
      'victim+1@example.com',
      ' victim+2@EXAMPLE.com ',
      'victim@example.com.',
    ];
    for (const v of variants) {
      expect(await send(v, IP_A)).toEqual(ALLOW);
    }
    expect(await send('victim+6@example.com', IP_A)).toEqual({
      kind: 'turnstile-required',
    });
  });

  it('the mailbox+IP pair has a hard cap even with valid tokens, with a truthful Retry-After', async () => {
    const results = await sendTimes(T.PAIR_MAX_SENDS, VICTIM, IP_A);
    expect(results.every(r => r.kind === 'allow')).toBe(true);
    clock += 4 * MINUTE;
    expect(await send(VICTIM, IP_A, 'ok-token')).toEqual({
      kind: 'rate-limited',
      retryAfterSeconds: (T.SHORT_WINDOW_MS - 4 * MINUTE) / 1000,
    });
  });

  it('a flood from one source does not lock the owner out from her own IP', async () => {
    await sendTimes(T.PAIR_MAX_SENDS + 3, VICTIM, IP_A);
    expect((await send(VICTIM, IP_A, 'ok-token')).kind).toBe('rate-limited');
    expect(await send(VICTIM, IP_B)).toEqual({ kind: 'turnstile-required' });
    expect(await send(VICTIM, IP_B, 'ok-token')).toEqual(ALLOW);
  });

  it('P1-A: free sends spread over a day cannot lock the owner out; past the daily budget only Turnstile is asked', async () => {
    // An attacker without Turnstile, 5 per 15-minute window, from rotating IPs.
    let attempts = 0;
    for (let window = 0; window < 12; window++) {
      for (let i = 0; i < T.EMAIL_FREE_SENDS_SHORT; i++) {
        await send(VICTIM, `203.0.113.${(attempts++ % 200) + 1}`);
      }
      clock += T.SHORT_WINDOW_MS;
    }
    expect(attempts).toBeGreaterThan(T.EMAIL_FREE_SENDS_DAILY);
    // The daily free budget is spent: even a fresh window asks for Turnstile...
    expect(await send(VICTIM, IP_B)).toEqual({ kind: 'turnstile-required' });
    // ...and a solved Turnstile is never refused by any mailbox-level limit.
    for (let i = 0; i < T.PAIR_MAX_SENDS - 1; i++) {
      expect(await send(VICTIM, IP_B, 'ok-token')).toEqual(ALLOW);
    }
  });

  it('P1-B: parallel requests cannot all skip Turnstile (decided on the atomic increment)', async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => send(VICTIM, `198.51.100.${i + 1}`))
    );
    expect(results.filter(r => r.kind === 'allow')).toHaveLength(
      T.EMAIL_FREE_SENDS_SHORT
    );
    expect(results.filter(r => r.kind === 'turnstile-required')).toHaveLength(
      30 - T.EMAIL_FREE_SENDS_SHORT
    );
  });

  it('the short window renews: after 15 minutes the free budget is back', async () => {
    await sendTimes(T.EMAIL_FREE_SENDS_SHORT, VICTIM, IP_A, null);
    expect((await send(VICTIM, IP_A)).kind).toBe('turnstile-required');
    clock += T.SHORT_WINDOW_MS - 1;
    expect((await send(VICTIM, IP_A)).kind).toBe('turnstile-required');
    clock += 1;
    expect(await send(VICTIM, IP_A)).toEqual(ALLOW);
  });

  it('the daily budget renews after a day', async () => {
    for (let i = 0; i < T.EMAIL_FREE_SENDS_DAILY; i++) {
      if (i % T.EMAIL_FREE_SENDS_SHORT === 0) {
        clock += T.SHORT_WINDOW_MS;
      }
      expect(await send(VICTIM, `192.0.2.${i + 1}`)).toEqual(ALLOW);
    }
    clock += T.SHORT_WINDOW_MS;
    expect((await send(VICTIM, IP_A)).kind).toBe('turnstile-required');
    clock += T.DAILY_WINDOW_MS;
    expect(await send(VICTIM, IP_A)).toEqual(ALLOW);
  });

  it('one IP spraying many mailboxes is challenged after its free budget', async () => {
    for (let i = 0; i < T.IP_FREE_SENDS; i++) {
      expect(await send(`person${i}@example.com`, IP_A)).toEqual(ALLOW);
    }
    expect(await send('next@example.com', IP_A)).toEqual({
      kind: 'turnstile-required',
    });
    expect(await send('next@example.com', IP_B)).toEqual(ALLOW);
  });

  it('IPv6 addresses of one /64 share the IP and pair budgets', async () => {
    const prefix = '2001:db8:aa:bb';
    for (let i = 0; i < T.IP_FREE_SENDS; i++) {
      expect(await send(`p${i}@example.com`, `${prefix}::${i + 1}`)).toEqual(
        ALLOW
      );
    }
    expect(await send('next@example.com', `${prefix}:ffff::1`)).toEqual({
      kind: 'turnstile-required',
    });
    expect(await send('next@example.com', '2001:db8:aa:bc::1')).toEqual(ALLOW);
  });

  it('no trusted IP is itself a risk signal', async () => {
    expect(await send(VICTIM, null)).toEqual({ kind: 'turnstile-required' });
    expect(await send(VICTIM, null, 'ok-token')).toEqual(ALLOW);
  });

  describe('Turnstile outcomes', () => {
    it('not configured: risky sends pass on the pair cap alone', async () => {
      deps.turnstileEnabled = () => false;
      await sendTimes(T.EMAIL_FREE_SENDS_SHORT, VICTIM, IP_A, null);
      expect(await send(VICTIM, IP_A)).toEqual({
        kind: 'allow',
        degraded: true,
      });
      const rest = await sendTimes(T.PAIR_MAX_SENDS, VICTIM, IP_A, null);
      expect(rest.at(-1)?.kind).toBe('rate-limited');
    });

    it.each([
      'siteverify-timeout',
      'siteverify-network',
      'siteverify-http-503',
      'siteverify-http-500',
    ])(
      'Cloudflare unavailable (%s): the send passes, degraded',
      async reason => {
        deps.verifyTurnstile.mockResolvedValue({ ok: false, reason });
        await sendTimes(T.EMAIL_FREE_SENDS_SHORT, VICTIM, IP_A, null);
        expect(await send(VICTIM, IP_A, 'any')).toEqual({
          kind: 'allow',
          degraded: true,
        });
      }
    );

    it.each([
      'siteverify-http-400',
      'siteverify-http-429',
      'siteverify-malformed-json',
      'siteverify-invalid-shape',
      'internal-error',
      'timeout-or-duplicate',
      'secret-not-configured',
    ])('%s is a rejected token, not an outage', async reason => {
      deps.verifyTurnstile.mockResolvedValue({ ok: false, reason });
      await sendTimes(T.EMAIL_FREE_SENDS_SHORT, VICTIM, IP_A, null);
      expect(await send(VICTIM, IP_A, 'any')).toEqual({
        kind: 'turnstile-invalid',
      });
    });
  });

  it('no account-existence leak: two addresses with the same history get the same answers', async () => {
    // The gate is given no user lookup at all (DB_CLIENT throws if touched); answers depend only
    // on the request history, so a registered and an unregistered address behave identically.
    const registered: string[] = [];
    const unknown: string[] = [];
    for (let i = 0; i < T.PAIR_MAX_SENDS + 2; i++) {
      const token = i % 2 ? 'ok-token' : null;
      registered.push((await send('registered@example.com', IP_A, token)).kind);
      unknown.push((await send('nobody-here@example.com', IP_B, token)).kind);
    }
    expect(unknown).toEqual(registered);
  });
});
