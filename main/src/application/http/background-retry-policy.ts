// Retry contract for background infrastructure reads.
//
// Foreground queries keep the global user-query policy. Background bootstrap /
// polling calls opt in explicitly so a future global retry change cannot create
// request or diagnostic bursts on static pages.

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { IOError } from './toPromise.adapter';

const BACKGROUND_RETRY_BASE_DELAY_MS = 5_000;
const BACKGROUND_RETRY_MAX_DELAY_MS = 30_000;
const BACKGROUND_MAX_RETRIES = 1;

/**
 * Background reads retry only a connectivity failure. HTTP 4xx/5xx already
 * reached the server, so repeating them during an outage merely multiplies XHRs
 * and diagnostics. A single delayed retry remains useful after a short mobile
 * network transition or a Capacitor resume.
 */
export const shouldRetryBackgroundQuery = (
  failureCount: number,
  error: Error
): boolean => {
  const event = (error as Partial<IOError<unknown>>).httpError?.event;
  return (
    failureCount < BACKGROUND_MAX_RETRIES &&
    event === APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM
  );
};

export const getBackgroundRetryDelay = (attemptIndex: number): number =>
  Math.min(
    BACKGROUND_RETRY_BASE_DELAY_MS * 2 ** attemptIndex,
    BACKGROUND_RETRY_MAX_DELAY_MS
  );

export const backgroundQueryRetryOptions = {
  retry: shouldRetryBackgroundQuery,
  retryDelay: getBackgroundRetryDelay,
} as const;
