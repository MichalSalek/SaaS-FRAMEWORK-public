/**
 * Shared retry helper for email delivery (transactional + lifecycle).
 *
 * sendLifecycleEmail (the transport layer) never throws — it returns
 * `boolean`. This wrapper retries `false` results with exponential
 * backoff. Bounded total wait so it fits inside both:
 *   - user-facing HTTP request budgets (transactional flow)
 *   - per-account budget inside lifecycle sweeps (6h cadence,
 *     hundreds of accounts processed sequentially)
 */

import { RETRY } from '@kernel/application/constants.config';
import { isMailgunDailyLimited } from './mailgun-daily-limit.breaker';
import { getEmailCircuitState } from './email-circuit-breaker';

export const RETRY_MAX_ATTEMPTS = RETRY.EMAIL_MAX_ATTEMPTS;
export const RETRY_BASE_DELAY_MS = RETRY.BASE_DELAY_MS;

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry a boolean-returning async function with exponential backoff.
 * Returns true on first success, false if all attempts return false.
 * Delays: baseDelay * 2^(attempt-1) — for defaults: 1s, 2s.
 *
 * `fn` receives `isFinalAttempt` so the transport can dead-letter exactly ONCE
 * per incident: pass it through as `deadLetterOnFailure` (lifecycle senders) or
 * hardcode `deadLetterOnFailure: false` when an outer layer owns the dead-letter
 * (email-transactional.ts writes its own FailedEmail + EMAIL_DEAD_LETTERED).
 */
export const withEmailDeliveryRetry = async (
  fn: (isFinalAttempt: boolean) => Promise<boolean>,
  maxAttempts: number = RETRY_MAX_ATTEMPTS,
  baseDelayMs: number = RETRY_BASE_DELAY_MS
): Promise<boolean> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await fn(attempt === maxAttempts);
    if (result) {
      return true;
    }
    if (attempt < maxAttempts) {
      // When Mailgun's daily cap is hit, BOTH transports fail-fast (no network)
      // and will keep failing until the next-day reset. Skip the backoff sleep —
      // remaining attempts still run (so the final attempt writes the dead-letter)
      // but instantly, with no wasted wait and no quota burned.
      if (isMailgunDailyLimited()) {
        continue;
      }
      // Circuit breaker OPEN → a non-critical send is suppressed deterministically
      // (sendLifecycleEmail returns false without touching a transport) and stays
      // suppressed until the bounce incident clears. Backoff between retries buys
      // nothing here, so skip the sleep — remaining attempts still run instantly
      // (final attempt keeps the dead-letter contract). Edge: a genuine transport
      // failure of a CRITICAL email during an OPEN episode also skips backoff —
      // acceptable, mirrors the daily-limit fast-path and still dead-letters.
      if (getEmailCircuitState() === 'OPEN') {
        continue;
      }
      await sleep(baseDelayMs * Math.pow(2, attempt - 1));
    }
  }
  return false;
};
