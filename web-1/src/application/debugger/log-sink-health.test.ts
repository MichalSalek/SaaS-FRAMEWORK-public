/**
 * Log-store liveness sensor: pins the three properties the whole point of this module rests on
 * (see the DECISION in `log-sink-health.ts`).
 *
 * Failure class pinned here: a log-write outage is invisible to the logger, which has no channel
 * other than the one that died. So the alarm must (1) leave through a channel without the database,
 * (2) be throttled so a lasting outage does not flood stdout and the PostHog quota, and (3) report
 * the RECOVERY too, otherwise the start of an outage is visible and never its end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureBackendIssue = vi.fn();
vi.mock('./posthog-server', () => ({
  captureBackendIssue: (...args: unknown[]) => captureBackendIssue(...args),
}));

type GlobalWithState = typeof globalThis & { __logSinkHealthState?: unknown };

async function freshModule() {
  delete (globalThis as GlobalWithState).__logSinkHealthState;
  vi.resetModules();
  return import('./log-sink-health');
}

describe('log-sink-health — dead-man’s switch składu logów', () => {
  beforeEach(() => {
    captureBackendIssue.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('pierwsza porażka alarmuje natychmiast, kanałem niezależnym od bazy', async () => {
    const { markLogSinkWriteFailed } = await freshModule();

    markLogSinkWriteFailed(new Error('log DB unreachable'));

    expect(captureBackendIssue).toHaveBeenCalledTimes(1);
    const [payload] = captureBackendIssue.mock.calls[0] as [
      { mode: string; namespace: string; message: string },
    ];
    expect(payload.mode).toBe('error');
    expect(payload.namespace).toBe('ALERT_LOG_SINK');
    expect(payload.message).toContain('[LOG_SINK_DOWN]');
  });

  it('dławi trwałą awarię do progów będących potęgami dziesiątki', async () => {
    const { markLogSinkWriteFailed } = await freshModule();

    for (let i = 0; i < 1000; i++) {
      markLogSinkWriteFailed(new Error('still down'));
    }

    // 1, 10, 100, 1000: four alarms per thousand failures. Without throttling there would be 1000.
    expect(captureBackendIssue).toHaveBeenCalledTimes(4);
  });

  it('zgłasza POWRÓT zapisów z długością serii i zeruje licznik', async () => {
    const {
      markLogSinkWriteFailed,
      markLogSinkWriteSucceeded,
      getLogSinkHealth,
    } = await freshModule();

    markLogSinkWriteFailed(new Error('down'));
    markLogSinkWriteFailed(new Error('down'));
    markLogSinkWriteFailed(new Error('down'));
    captureBackendIssue.mockClear();

    markLogSinkWriteSucceeded();

    expect(captureBackendIssue).toHaveBeenCalledTimes(1);
    const [payload] = captureBackendIssue.mock.calls[0] as [
      {
        mode: string;
        message: string;
        payload: { recovered_after_failures: number };
      },
    ];
    expect(payload.mode).toBe('warn');
    expect(payload.message).toContain('[LOG_SINK_RECOVERED]');
    expect(payload.payload.recovered_after_failures).toBe(3);
    expect(getLogSinkHealth().consecutiveFailures).toBe(0);
  });

  it('sukces bez wcześniejszej porażki NIE generuje szumu', async () => {
    const { markLogSinkWriteSucceeded } = await freshModule();

    markLogSinkWriteSucceeded();
    markLogSinkWriteSucceeded();

    expect(captureBackendIssue).not.toHaveBeenCalled();
  });

  it('nigdy nie rzuca — nawet gdy kanał alarmowy sam padnie', async () => {
    const { markLogSinkWriteFailed } = await freshModule();
    captureBackendIssue.mockImplementation(() => {
      throw new Error('PostHog down too');
    });

    expect(() => markLogSinkWriteFailed(new Error('down'))).not.toThrow();
  });

  it('stan przeżywa DRUGĄ ewaluację modułu (Next bundluje go dwa razy)', async () => {
    const first = await freshModule();
    first.markLogSinkWriteFailed(new Error('down'));

    // A second, independent evaluation of the same module in one process, exactly what Next does
    // for instrumentation.ts and pages/api. Without state on globalThis the counter would reset to
    // zero and the threshold ladder would start over.
    vi.resetModules();
    const second = await import('./log-sink-health');

    expect(second.getLogSinkHealth().consecutiveFailures).toBe(1);
  });
});
