import { describe, it, expect } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { isProfileNotFoundError } from './_profile-error.helpers';

const ioError = (event: EVENT_INFO_TYPE) =>
  Object.assign(new Error(event), { httpError: { event, data: undefined } });

describe('isProfileNotFoundError', () => {
  it('treats a 404 account-not-found answer as a missing profile', () => {
    expect(
      isProfileNotFoundError(ioError(APP_EVENTS.INFO.ACCOUNT.ACCOUNT_NOT_FOUND))
    ).toBe(true);
  });

  it('treats an empty-identifier validation answer as a missing profile', () => {
    expect(
      isProfileNotFoundError(
        ioError(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED)
      )
    ).toBe(true);
  });

  it('keeps network and server failures as "could not check"', () => {
    expect(
      isProfileNotFoundError(
        ioError(APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM)
      )
    ).toBe(false);
    expect(isProfileNotFoundError(new Error('boom'))).toBe(false);
    expect(isProfileNotFoundError(null)).toBe(false);
  });
});
