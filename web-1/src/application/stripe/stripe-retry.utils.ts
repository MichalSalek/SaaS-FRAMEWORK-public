/**
 * Shared retry primitives for Stripe API operations.
 *
 * Centralises the error-classification + exponential-backoff loop that was
 * previously duplicated in `customer.operations.ts`. Any Stripe call that needs
 * "retry on transient, fail-fast on permanent" semantics should go through
 * `retryStripeOperation` so the policy is enforced in one place.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Retry classification — Stripe API 4xx (except 429) are caller errors
 * (invalid params, missing resources, bad keys). Retrying them burns quota
 * and never succeeds. We only retry:
 *   - network / unknown errors (no HTTP status)
 *   - 429 (rate limit) — Stripe explicitly asks us to back off
 *   - 5xx (server side) — transient by definition
 * Permanent errors (400/401/403/404) short-circuit to fallback immediately.
 *
 * Backoff strategy: exponential with base 1000ms, factor 2 → 1s, 2s, 4s.
 * Max attempts: 3. Total worst case: 1+2+4 = 7s wait + 3 API calls. Fits
 * comfortably inside Stripe webhook ack budget (we already runAfterResponse
 * for anything that doesn't block the 200 OK).
 */

import { reportIssueBackend } from '@app/debugger/error-handler';
import { RETRY } from '@kernel/application/constants.config';

export const STRIPE_RETRY_MAX_ATTEMPTS = RETRY.MAX_ATTEMPTS;
export const STRIPE_RETRY_BASE_DELAY_MS = RETRY.BASE_DELAY_MS;

/** HTTP status codes that indicate a transient, retryable failure. */
const isRetryableStatus = (status: number): boolean => {
  if (status === 429) {
    return true;
  }
  return status >= 500;
};

/**
 * Extract HTTP status code from a Stripe error. Stripe SDK exposes both
 * `statusCode` (legacy) and `status` on different error shapes; check both.
 */
const getErrorStatus = (error: unknown): number | undefined => {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const candidate = error as { statusCode?: number; status?: number };
  return candidate.statusCode ?? candidate.status;
};

/**
 * Returns true if a Stripe error should be retried. Unknown error shapes are
 * treated as retryable (conservative — better to waste a retry than to drop
 * a real transient failure).
 */
export const isRetryableStripeError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return true; // unknown shape — retry conservatively
  }
  const status = getErrorStatus(error);
  if (typeof status !== 'number') {
    return true; // network / timeout — retry
  }
  return isRetryableStatus(status);
};

/** Extract Stripe-specific error `code` (e.g. `resource_missing`). */
export const getStripeErrorCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || !('code' in error)) {
    return undefined;
  }
  return (error as { code?: string }).code;
};

/** Per-attempt outcome captured for audit trail. */
export type StripeRetryAttempt = {
  attempt: number;
  ok: boolean;
  errorMessage?: string | undefined;
  errorCode?: string | undefined;
  errorStatus?: number | undefined;
  retryable?: boolean | undefined;
};

export type StripeRetryResult<T> =
  | { ok: true; value: T; attempts: StripeRetryAttempt[] }
  | { ok: false; attempts: StripeRetryAttempt[] };

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Execute a Stripe operation with retry policy.
 *
 * Returns a discriminated result so callers can implement explicit
 * fallback paths without try/catch around the whole call.
 *
 * @param fn        — the Stripe SDK call to execute (idempotent ops only).
 * @param namespace — reportIssueBackend namespace for per-attempt audit logs.
 * @param payload   — context attached to every audit log entry (e.g. ids).
 * @param maxAttempts / baseDelayMs — overrides for non-default budgets.
 */
export const retryStripeOperation = async <T>({
  fn,
  namespace,
  payload,
  maxAttempts = STRIPE_RETRY_MAX_ATTEMPTS,
  baseDelayMs = STRIPE_RETRY_BASE_DELAY_MS,
}: {
  fn: () => Promise<T>;
  namespace: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  baseDelayMs?: number;
}): Promise<StripeRetryResult<T>> => {
  const attempts: StripeRetryAttempt[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn();
      attempts.push({ attempt, ok: true });
      reportIssueBackend({
        namespace: `${namespace}_ATTEMPT_OK`,
        message: `Stripe operation succeeded on attempt ${attempt}`,
        payload: { ...payload, attempt, maxAttempts },
        mode: attempt === 1 ? 'info' : 'warn',
      });
      return { ok: true, value, attempts };
    } catch (error) {
      const retryable = isRetryableStripeError(error);
      const status = getErrorStatus(error);
      const code = getStripeErrorCode(error);
      const message = error instanceof Error ? error.message : String(error);

      attempts.push({
        attempt,
        ok: false,
        errorMessage: message,
        errorCode: code,
        errorStatus: status,
        retryable,
      });

      reportIssueBackend({
        namespace: `${namespace}_ATTEMPT_FAIL`,
        message: `Stripe operation attempt ${attempt}/${maxAttempts} failed (retryable=${retryable})`,
        payload: {
          ...payload,
          attempt,
          maxAttempts,
          retryable,
          errorStatus: status,
          errorCode: code,
          errorMessage: message,
        },
        mode: retryable && attempt < maxAttempts ? 'warn' : 'error',
      });

      if (!retryable || attempt === maxAttempts) {
        return { ok: false, attempts };
      }
      await sleep(baseDelayMs * Math.pow(2, attempt - 1));
    }
  }

  // Unreachable — loop always returns or throws inside the catch path.
  return { ok: false, attempts };
};
