/**
 * Magistrala zdarzeń INFO — rejestr subskrypcji MUSI przeżyć drugą ewaluację modułu.
 *
 * KLASA BŁĘDU, którą ta suita pinuje (znaleziona 2026-08-20): rejestr był
 * module-level `new Map()`, a Next bunduje ten moduł OSOBNO dla `instrumentation.ts`
 * i dla `pages/api/**`. Subskrypcje lądowały więc w jednej kopii, a `emit()`
 * z handlera API — w drugiej, pustej na zawsze. `emit()` przy pustej liście po
 * prostu wychodził, więc trzy maile powiadomień nigdy nie poszły, request zwracał
 * 200, i nie było po tym ŻADNEGO śladu: ani wpisu w EventLogu, ani FailedEmail,
 * ani zgłoszenia błędu. Na bazie dev: 59 × PAIR_REQUEST_SENT, 114 ×
 * PAIRING_SESSION_CLAIMED, 34 × SESSION_CONTAINER_SHARED i zero maili.
 *
 * `vi.resetModules()` + ponowny import odtwarza dokładnie ten scenariusz: to druga,
 * niezależna ewaluacja tego samego modułu w jednym procesie. Test przechodzi tylko
 * wtedy, gdy rejestr żyje na globalThis.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const reportIssueBackend = vi.fn();
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: (...args: unknown[]) => reportIssueBackend(...args),
}));

// runAfterResponse normalnie odracza handler poza cykl odpowiedzi; tutaj wołamy go
// od razu, żeby test obserwował sam fakt dostarczenia, nie harmonogram.
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
    // Cisza była tu równie groźna jak sam rozjazd rejestru: „nikt nie słucha"
    // wyglądało identycznie jak „nie ma czego wysyłać", więc awaria przeżyła
    // cały czas życia magistrali.
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
