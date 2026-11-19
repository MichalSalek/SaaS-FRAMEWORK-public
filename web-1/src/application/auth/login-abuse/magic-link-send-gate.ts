import { MAGIC_LINK_THROTTLE } from './login-abuse.config';
import {
  normalizeEmailForThrottle,
  throttleKeyPart,
} from './email-throttle-key';
import { toRateLimitIpKey } from '@app/http/trust-aware-ip';
import type { ThrottleCounterStore } from '@app/security/throttle-counter.store';
import type { TurnstileVerifyResult } from '@app/security/turnstile.verify';

/**
 * Magic-link send throttle (owner D10): free budgets per mailbox and per IP, Cloudflare Turnstile
 * asked ONLY after a risk signal, and one hard cap per mailbox+IP pair.
 *
 * Order of a decision:
 *  1. mailbox+IP pair over its hard cap -> rate-limited (Retry-After = that window's end)
 *  2. risk = mailbox over its free short OR daily budget, OR the IP over its free budget across
 *     mailboxes, OR no trusted IP at all
 *  3. on risk: no token -> turnstile-required; rejected token -> turnstile-invalid; Turnstile not
 *     configured or Cloudflare unreachable -> allowed on the pair cap alone (degraded)
 */

// DECISION: every budget is decided on the value its increment returns (store.hit), never on a
// separate read: with read-then-increment, N parallel requests all saw the same count and all
// skipped Turnstile. A request is counted on arrival, refused or not.
// Test: web-1/src/application/auth/login-abuse/magic-link-send-gate.test.ts (covers parallel
// requests on the in-memory store) and web-1/src/application/security/throttle-counter.store.test.ts
// (covers 30 parallel hits getting distinct counts in memory; not the SQL upsert across sessions).

// DECISION: nothing keyed on the MAILBOX alone ever refuses a send. Its budgets only decide whether
// Turnstile is required (a hard per-mailbox ceiling let an attacker lock the owner out for a day).
// The pair cap is the only refusal. The decision never reads the user table, so outcomes are the
// same for an existing and a non-existing account (no enumeration).

export type MagicLinkSendDecision =
  | { kind: 'allow'; degraded: boolean }
  | { kind: 'rate-limited'; retryAfterSeconds: number }
  | { kind: 'turnstile-required' }
  | { kind: 'turnstile-invalid' };

export type MagicLinkSendGateDeps = {
  store: ThrottleCounterStore;
  turnstileEnabled: () => boolean;
  verifyTurnstile: (input: {
    token: string;
    remoteIp: string | null;
  }) => Promise<TurnstileVerifyResult>;
  now: () => Date;
};

/**
 * Failures of Cloudflare itself (5xx, network, timeout): the degraded path applies. Everything else
 * (a negative verdict, a 4xx, a malformed answer) is treated as a rejected token.
 */
const isTurnstileUnavailable = (reason: string): boolean =>
  reason === 'siteverify-timeout' ||
  reason === 'siteverify-network' ||
  /^siteverify-http-5\d\d$/u.test(reason);

const keys = (mailbox: string, ip: string | null) => {
  const mailboxKey = throttleKeyPart(mailbox);
  const ipKey = ip === null ? null : toRateLimitIpKey(ip);
  return {
    mailboxDaily: `ml:mailbox:1d:${mailboxKey}`,
    mailboxShort: `ml:mailbox:15m:${mailboxKey}`,
    pair:
      ipKey === null
        ? null
        : `ml:pair:15m:${throttleKeyPart(`${mailbox}|${ipKey}`)}`,
    ip: ipKey === null ? null : `ml:ip:15m:${throttleKeyPart(ipKey)}`,
  };
};

export const evaluateMagicLinkSend = async (
  input: { email: string; ip: string | null; turnstileToken: string | null },
  deps: MagicLinkSendGateDeps
): Promise<MagicLinkSendDecision> => {
  const mailbox = normalizeEmailForThrottle(input.email);
  if (mailbox === null) {
    // Not an address Better Auth would accept either; its own validation answers.
    return { kind: 'allow', degraded: false };
  }
  const now = deps.now();
  const k = keys(mailbox, input.ip);
  const t = MAGIC_LINK_THROTTLE;

  if (k.pair !== null) {
    const pair = await deps.store.hit(k.pair, t.SHORT_WINDOW_MS, now);
    if (pair.count > t.PAIR_MAX_SENDS) {
      return {
        kind: 'rate-limited',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((pair.resetAt.getTime() - now.getTime()) / 1000)
        ),
      };
    }
  }

  const [mailboxShort, mailboxDaily, ipCount] = await Promise.all([
    deps.store.hit(k.mailboxShort, t.SHORT_WINDOW_MS, now),
    deps.store.hit(k.mailboxDaily, t.DAILY_WINDOW_MS, now),
    k.ip === null
      ? Promise.resolve(null)
      : deps.store.hit(k.ip, t.SHORT_WINDOW_MS, now),
  ]);

  const risky =
    ipCount === null ||
    ipCount.count > t.IP_FREE_SENDS ||
    mailboxShort.count > t.EMAIL_FREE_SENDS_SHORT ||
    mailboxDaily.count > t.EMAIL_FREE_SENDS_DAILY;
  if (!risky) {
    return { kind: 'allow', degraded: false };
  }

  if (!deps.turnstileEnabled()) {
    return { kind: 'allow', degraded: true };
  }
  if (input.turnstileToken === null) {
    return { kind: 'turnstile-required' };
  }
  const verdict = await deps.verifyTurnstile({
    token: input.turnstileToken,
    remoteIp: input.ip,
  });
  if (verdict.ok) {
    return { kind: 'allow', degraded: false };
  }
  return isTurnstileUnavailable(verdict.reason)
    ? { kind: 'allow', degraded: true }
    : { kind: 'turnstile-invalid' };
};
