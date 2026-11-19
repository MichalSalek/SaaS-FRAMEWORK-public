import { TIME } from '@kernel/application/constants.config';
import { TRUSTED_CLIENT_IP_HEADER } from '../better-auth/client-ip-stamp';

/**
 * Login abuse limits: the ONE place for every threshold on the way to a login e-mail.
 *
 * Three layers, all keyed on the same trust-aware client IP (trust-aware-ip.ts, stamped for Better
 * Auth by client-ip-stamp.ts; IPv6 collapsed to its /64), from the outside in:
 *  1. App limiter (rate-limit.middleware.ts): `/api/auth/*` is a strict endpoint, 50 requests per
 *     10 s per IP and path. A deliberately loose flood guard.
 *  2. Better Auth limiter (memory, per IP and path): the magic-link plugin rule, 5 per 60 s, on the
 *     send and verify paths. It REPLACES the built-in `/sign-in*` rule (3 per 10 s) for
 *     `/sign-in/magic-link`; other `/sign-in/*` paths (social) keep 3 per 10 s.
 *  3. Magic-link send throttle (magic-link-send-gate.ts, ThrottleCounter table): MAGIC_LINK_THROTTLE
 *     below, independent of whether an account exists.
 */

// DECISION: budgets on a MAILBOX never refuse a send; past them a send needs a solved Turnstile.
// Only the mailbox+IP pair has a hard cap (a hard per-mailbox ceiling was a lockout tool).
// Thresholds come from production traffic (owner D10): real users logged in by magic link at most
// once a day; the internal check account peaked at 22 a day and 6 in 15 minutes. So 5 free sends
// per 15 minutes cover one `test:prod` run plus resends, and 30 per day sit above the busiest day.
// A daily budget under ~25 makes `npm run test:prod` hit Turnstile, which a script cannot solve.
export const MAGIC_LINK_THROTTLE = {
  /** Window of the short budgets (mailbox, mailbox+IP pair, IP). */
  SHORT_WINDOW_MS: 15 * TIME.MS_PER_MINUTE,
  /** Window of the daily mailbox budget. */
  DAILY_WINDOW_MS: TIME.MS_PER_DAY,
  /** Sends per mailbox per short window without Turnstile (any IP). */
  EMAIL_FREE_SENDS_SHORT: 5,
  /** Sends per mailbox per day without Turnstile (any IP); beyond it every send needs Turnstile. */
  EMAIL_FREE_SENDS_DAILY: 30,
  /** Sends per IP per short window, across mailboxes, without Turnstile. */
  IP_FREE_SENDS: 10,
  /** HARD cap per mailbox AND IP per short window (the only refusal): one source, one inbox. */
  PAIR_MAX_SENDS: 10,
} as const;

/** Better Auth's own limiter (layer 2). Values equal the library defaults, pinned here on purpose. */
export const BETTER_AUTH_RATE_LIMIT = {
  WINDOW_S: 10,
  MAX: 100,
  MAGIC_LINK_WINDOW_S: 60,
  MAGIC_LINK_MAX: 5,
} as const;

/**
 * Better Auth options for layer 2. `betterAuth` is spread into the top-level config: the limiter
 * thresholds plus the ONLY header it may read the client IP from (DECISION in
 * better-auth/client-ip-stamp.ts). `magicLink` is the plugin's `rateLimit` (send and verify, per IP
 * and path).
 */
export const LOGIN_LIMIT_OPTIONS = {
  betterAuth: {
    advanced: { ipAddress: { ipAddressHeaders: [TRUSTED_CLIENT_IP_HEADER] } },
    rateLimit: {
      window: BETTER_AUTH_RATE_LIMIT.WINDOW_S,
      max: BETTER_AUTH_RATE_LIMIT.MAX,
    },
  },
  magicLink: {
    window: BETTER_AUTH_RATE_LIMIT.MAGIC_LINK_WINDOW_S,
    max: BETTER_AUTH_RATE_LIMIT.MAGIC_LINK_MAX,
  },
};
