// main/src/application/http/user-retry-policy.ts
// Shared TQ retry helper for default user queries — skip retry on permission/not-found/validation errors.
// Used as default in queryClient.config.ts (DD3-F4).

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS } from '@kernel/application/auth/auth.config';
import type { IOError } from './toPromise.adapter';

/**
 * HTTPError carries no statusCode, only `event`, so "no point retrying" is mapped by event (the Set
 * below). Everything else (network, 500, transient) retries once: a Capacitor WebView often has no
 * network right after waking from background, and staleTime=60s alone would still show an error on
 * the first refetch after app resume.
 */
const NON_RETRYABLE_EVENTS: ReadonlySet<EVENT_INFO_TYPE> =
  new Set<EVENT_INFO_TYPE>([
    APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
    APP_EVENTS.INFO.APPLICATION.NOT_FOUND,
    APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
    APP_EVENTS.INFO.USER.UNAUTHORIZED,
    APP_EVENTS.INFO.USER.LOGIN_FIRST,
    APP_EVENTS.INFO.USER.USER_NOT_FOUND,
    APP_EVENTS.INFO.ACCOUNT.ACCOUNT_NOT_FOUND,
  ]);

/**
 * DECISION: 503 AUTH_UNAVAILABLE (the server could not CHECK the session or permissions because its
 * own infrastructure failed) is retried for READS only, at most twice, each after the server's
 * `retryAfter`. The token stays (not an AUTH_TOKEN_INVALIDATING event), so the retry rides the same
 * credentials. Mutations never retry (`mutations.retry: false` in queryClient.config.ts): replaying
 * a non-idempotent POST could double its effect; the user repeats it after the message.
 */
const AUTH_UNAVAILABLE_MAX_RETRIES = 2;
const AUTH_UNAVAILABLE_MAX_DELAY_SECONDS = 60;

const readEvent = (error: Error): EVENT_INFO_TYPE | undefined =>
  (error as Partial<IOError<unknown>>).httpError?.event;

/** Seconds the server asked us to wait (`data.retryAfter`), bounded; the kernel default otherwise. */
export const getAuthUnavailableRetryAfterSeconds = (error: Error): number => {
  const data: unknown = (error as Partial<IOError<unknown>>).httpError?.data;
  const asked =
    typeof data === 'object' && data !== null && 'retryAfter' in data
      ? data.retryAfter
      : undefined;
  return typeof asked === 'number' && Number.isFinite(asked) && asked > 0
    ? Math.min(asked, AUTH_UNAVAILABLE_MAX_DELAY_SECONDS)
    : AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS;
};

export const shouldRetryUserQuery = (
  failureCount: number,
  error: Error
): boolean => {
  const event = readEvent(error);
  if (event === APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE) {
    return failureCount < AUTH_UNAVAILABLE_MAX_RETRIES;
  }
  if (event !== undefined && NON_RETRYABLE_EVENTS.has(event)) {
    return false;
  }
  return failureCount < 1; // max 1 retry
};

/** TanStack's default backoff, except AUTH_UNAVAILABLE waits as long as the server asked. */
export const getUserQueryRetryDelay = (
  attemptIndex: number,
  error: Error
): number => {
  if (readEvent(error) === APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE) {
    return getAuthUnavailableRetryAfterSeconds(error) * 1000;
  }
  return Math.min(1000 * 2 ** attemptIndex, 30_000);
};
