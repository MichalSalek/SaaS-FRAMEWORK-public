// Retry contract for background infrastructure reads.
//
// Foreground queries keep the global user-query policy. Background bootstrap /
// polling calls opt in explicitly so a future global retry change cannot create
// request or diagnostic bursts on static pages.

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { IOError } from './toPromise.adapter';
import { getAuthUnavailableRetryAfterSeconds } from './user-retry-policy';

const BACKGROUND_RETRY_BASE_DELAY_MS = 5_000;
const BACKGROUND_RETRY_MAX_DELAY_MS = 30_000;
const BACKGROUND_MAX_RETRIES = 1;

/**
 * Background reads retry a connectivity failure (and AUTH_UNAVAILABLE, below). Other HTTP 4xx/5xx already
 * reached the server, so repeating them during an outage merely multiplies XHRs
 * and diagnostics. A single delayed retry remains useful after a short mobile
 * network transition or a Capacitor resume.
 */
/**
 * DECISION: 503 AUTH_UNAVAILABLE is the one HTTP answer retried here (once, after the server's
 * `retryAfter`). The server could not CHECK the session, the token is kept, and these background
 * reads include the identity query: without a retry a short database blip left the app on an
 * errored current-user until the next manual action.
 */
const isRetryableBackgroundEvent = (error: Error): boolean => {
  const event = (error as Partial<IOError<unknown>>).httpError?.event;
  return (
    event === APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM ||
    event === APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE
  );
};

export const shouldRetryBackgroundQuery = (
  failureCount: number,
  error: Error
): boolean =>
  failureCount < BACKGROUND_MAX_RETRIES && isRetryableBackgroundEvent(error);

export const getBackgroundRetryDelay = (
  attemptIndex: number,
  error?: Error
): number => {
  if (
    error !== undefined &&
    (error as Partial<IOError<unknown>>).httpError?.event ===
      APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE
  ) {
    return getAuthUnavailableRetryAfterSeconds(error) * 1000;
  }
  return Math.min(
    BACKGROUND_RETRY_BASE_DELAY_MS * 2 ** attemptIndex,
    BACKGROUND_RETRY_MAX_DELAY_MS
  );
};

export const backgroundQueryRetryOptions = {
  retry: shouldRetryBackgroundQuery,
  retryDelay: getBackgroundRetryDelay,
} as const;
