import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTurnstileFailureReporter } from './turnstile-diagnostics';

const report = vi.hoisted(() => vi.fn());
vi.mock('../error-debugger/errorHandler.possibilities.api', () => ({
  reportIssueFrontend: report,
}));
beforeEach(() => report.mockClear());

describe('Turnstile diagnostics boundary', () => {
  it('never forwards vendor payloads or malformed codes', () => {
    const log = createTurnstileFailureReporter();
    log('challenge', 1, {
      token: 'private-token',
      message: '?authCode=private',
    });
    log('challenge', 2, '300030?token=private');
    expect(report.mock.calls.map(([entry]) => entry.payload)).toEqual([
      { phase: 'challenge', attempt: 1, error_code: null },
      { phase: 'challenge', attempt: 2, error_code: null },
    ]);
  });
  it('bounds repeated automatic failures and keeps a new manual attempt distinguishable', () => {
    const log = createTurnstileFailureReporter();
    for (let i = 0; i < 20; i++) {
      log('challenge', 1, '300030');
    }
    expect(report).toHaveBeenCalledTimes(1);
    log('challenge', 2, '300030');
    expect(report).toHaveBeenCalledTimes(2);
    for (let i = 3; i < 30; i++) {
      log('timeout', i);
    }
    expect(report).toHaveBeenCalledTimes(10);
  });
});
