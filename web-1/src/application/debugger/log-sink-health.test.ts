/**
 * Czujnik żywotności składu logów — pinuje trzy własności, na których stoi cały sens
 * tego modułu (patrz DECISION w `log-sink-health.ts`).
 *
 * KLASA BŁĘDU, którą suita pilnuje: awaria zapisu logów jest niewidoczna dla loggera,
 * bo logger nie ma innego kanału niż ten, który padł. Alarm musi więc (1) wyjść kanałem
 * bez bazy, (2) być dławiony, żeby trwała awaria nie zalała stdoutu i quoty PostHoga,
 * (3) zgłosić także POWRÓT — inaczej widać początek awarii i nigdy jej koniec.
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

    // 1, 10, 100, 1000 — cztery alarmy na tysiąc porażek. Bez dławienia byłoby ich 1000.
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

    // Druga, niezależna ewaluacja tego samego modułu w jednym procesie — dokładnie to,
    // co robi Next dla instrumentation.ts i pages/api. Bez stanu na globalThis licznik
    // wróciłby do zera, a drabinka progów zaczęłaby się od nowa.
    vi.resetModules();
    const second = await import('./log-sink-health');

    expect(second.getLogSinkHealth().consecutiveFailures).toBe(1);
  });
});
