import { describe, expect, it } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { lookupFailurePhase } from './useQrScanner';

function ioError(event: string): Error {
  return Object.assign(new Error(event), {
    httpError: { event, data: undefined },
  });
}

describe('lookupFailurePhase', () => {
  it('reports a connection problem as lookupFailed, not as an unknown code', () => {
    expect(
      lookupFailurePhase(
        ioError(APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM)
      )
    ).toBe('lookupFailed');
  });

  it('keeps a backend refusal (e.g. profile missing) as notFound', () => {
    expect(
      lookupFailurePhase(ioError(APP_EVENTS.INFO.ACCOUNT.ACCOUNT_NOT_FOUND))
    ).toBe('notFound');
  });

  it('treats a non-IO exception as notFound', () => {
    expect(lookupFailurePhase(new TypeError('boom'))).toBe('notFound');
  });
});
