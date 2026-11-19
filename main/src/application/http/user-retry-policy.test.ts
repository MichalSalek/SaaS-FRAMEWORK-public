import { describe, expect, it } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS } from '@kernel/application/auth/auth.config';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import {
  getUserQueryRetryDelay,
  shouldRetryUserQuery,
} from './user-retry-policy';
import { queryClient } from './queryClient.config';

const ioError = (event: EVENT_INFO_TYPE, data?: unknown): Error =>
  Object.assign(new Error(event), { httpError: { event, data } });

const AUTH_UNAVAILABLE = APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE;

describe('user query retry: AUTH_UNAVAILABLE', () => {
  it('retries a read twice, then stops', () => {
    const error = ioError(AUTH_UNAVAILABLE, { retryAfter: 5 });
    expect(AUTH_UNAVAILABLE).toBe('AUTH_UNAVAILABLE');
    expect(shouldRetryUserQuery(0, error)).toBe(true);
    expect(shouldRetryUserQuery(1, error)).toBe(true);
    expect(shouldRetryUserQuery(2, error)).toBe(false);
  });

  it('waits as long as the server asked, bounded, with the kernel default as fallback', () => {
    expect(
      getUserQueryRetryDelay(0, ioError(AUTH_UNAVAILABLE, { retryAfter: 7 }))
    ).toBe(7_000);
    expect(
      getUserQueryRetryDelay(0, ioError(AUTH_UNAVAILABLE, { retryAfter: 900 }))
    ).toBe(60_000);
    expect(getUserQueryRetryDelay(1, ioError(AUTH_UNAVAILABLE))).toBe(
      AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS * 1000
    );
  });

  it('keeps the existing contract for other events', () => {
    expect(
      shouldRetryUserQuery(0, ioError(APP_EVENTS.INFO.USER.LOGIN_FIRST))
    ).toBe(false);
    const generic = ioError(APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR);
    expect(shouldRetryUserQuery(0, generic)).toBe(true);
    expect(shouldRetryUserQuery(1, generic)).toBe(false);
    expect(getUserQueryRetryDelay(1, generic)).toBe(2_000);
  });

  it('the query client uses this delay for reads and never replays a mutation', () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.retryDelay).toBe(getUserQueryRetryDelay);
    expect(defaults.mutations?.retry).toBe(false);
  });
});
