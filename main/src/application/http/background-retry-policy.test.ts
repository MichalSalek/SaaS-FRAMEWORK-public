import { describe, expect, it } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS } from '@kernel/application/auth/auth.config';
import type { IOError } from './toPromise.adapter';
import {
  getBackgroundRetryDelay,
  shouldRetryBackgroundQuery,
} from './background-retry-policy';

const ioError = (event: EVENT_INFO_TYPE, data?: unknown): IOError<unknown> =>
  Object.assign(new Error(event), {
    httpError: { event, data },
  });

describe('background query retry policy', () => {
  it('retries one connectivity failure and then stops', () => {
    const error = ioError(
      APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM
    );

    expect(shouldRetryBackgroundQuery(0, error)).toBe(true);
    expect(shouldRetryBackgroundQuery(1, error)).toBe(false);
  });

  it.each([
    APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR,
    APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
    APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
    APP_EVENTS.INFO.USER.UNAUTHORIZED,
  ])('does not retry an HTTP/business event: %s', event => {
    expect(shouldRetryBackgroundQuery(0, ioError(event))).toBe(false);
  });

  it('does not retry an unknown client-side error', () => {
    expect(
      shouldRetryBackgroundQuery(0, new Error('unexpected parser failure'))
    ).toBe(false);
  });

  it('uses bounded exponential delay', () => {
    expect(getBackgroundRetryDelay(0)).toBe(5_000);
    expect(getBackgroundRetryDelay(1)).toBe(10_000);
    expect(getBackgroundRetryDelay(10)).toBe(30_000);
  });

  it('retries 503 AUTH_UNAVAILABLE once, after the server retryAfter', () => {
    const error = ioError(APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE, {
      retryAfter: 7,
    });
    expect(shouldRetryBackgroundQuery(0, error)).toBe(true);
    expect(shouldRetryBackgroundQuery(1, error)).toBe(false);
    expect(getBackgroundRetryDelay(0, error)).toBe(7_000);
    expect(
      getBackgroundRetryDelay(
        0,
        ioError(APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE)
      )
    ).toBe(AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS * 1000);
  });

  it('keeps the exponential delay for connectivity failures', () => {
    expect(
      getBackgroundRetryDelay(
        1,
        ioError(APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM)
      )
    ).toBe(10_000);
  });
});
