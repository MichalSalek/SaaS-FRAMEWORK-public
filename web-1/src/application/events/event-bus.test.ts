/**
 * The INFO event-bus registry must survive a second evaluation of the module.
 * Next bundles this file separately for `instrumentation.ts` and for `pages/api`.
 * A module-level Map took subscriptions in one copy while `emit()` from an API
 * handler hit the other, empty copy, and returned with no mail and no log.
 * `vi.resetModules()` plus a fresh import is that second evaluation. The test
 * passes only when the registry lives on globalThis.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const reportIssueBackend = vi.fn();
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: (...args: unknown[]) => reportIssueBackend(...args),
}));

// runAfterResponse normally defers the handler past the response. Here it runs
// immediately so the test sees delivery, not the schedule.
vi.mock('@app/runtime/run-after-response', () => ({
  runAfterResponse: (task: () => Promise<void>) => {
    void task();
  },
}));

const EVENT = APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT;

describe('event-bus — rejestr subskrypcji na globalThis', () => {
  beforeEach(() => {
    reportIssueBackend.mockClear();
    delete (
      globalThis as typeof globalThis & { __appInfoEventHandlers?: unknown }
    ).__appInfoEventHandlers;
    vi.resetModules();
  });

  it('handler zarejestrowany w PIERWSZEJ ewaluacji modułu odbiera emit z DRUGIEJ', async () => {
    const first = await import('./event-bus');
    const received: unknown[] = [];
    first.eventBus.subscribe(EVENT, async payload => {
      received.push(payload);
    });

    // Druga, niezależna ewaluacja tego samego modułu = drugi bundle w Next.
    vi.resetModules();
    const second = await import('./event-bus');
    expect(second).not.toBe(first);

    second.eventBus.emit(EVENT, {
      stylistUserId: 'usr_1',
      stylistEmail: 'stylist@example.com',
      stylistName: 'Ola',
      clientName: 'Ala',
      locale: 'pl',
    } as never);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(received).toHaveLength(1);
  });

  it('powtórna rejestracja tego samego handlera NIE dubluje wywołań', async () => {
    // Odwrotna strona przeniesienia rejestru na globalThis: mapa przeżywa moduł,
    // więc druga ewaluacja `instrumentation.ts` wpięłaby te same listenery ponownie
    // i każde powiadomienie poszłoby dwa razy.
    const first = await import('./event-bus');
    const received: unknown[] = [];
    const handler = async (payload: unknown): Promise<void> => {
      received.push(payload);
    };

    first.eventBus.subscribe(EVENT, handler as never);
    vi.resetModules();
    const second = await import('./event-bus');
    second.eventBus.subscribe(EVENT, handler as never);

    second.eventBus.emit(EVENT, { stylistUserId: 'usr_1' } as never);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(received).toHaveLength(1);
  });

  it('emit bez ani jednego subskrybenta zgłasza błąd, zamiast wyjść po cichu', async () => {
    // Silence here was as dangerous as the split registry: "nobody is listening"
    // looked the same as "nothing to send", so the failure left no trace.
    const { eventBus } = await import('./event-bus');

    eventBus.emit(EVENT, {
      stylistUserId: 'usr_1',
      stylistEmail: 'stylist@example.com',
      stylistName: 'Ola',
      clientName: 'Ala',
      locale: 'pl',
    } as never);

    expect(reportIssueBackend).toHaveBeenCalledTimes(1);
    expect(reportIssueBackend.mock.calls[0]?.[0]).toMatchObject({
      namespace: 'EVENT_BUS_NO_HANDLER',
      mode: 'error',
    });
  });
});
