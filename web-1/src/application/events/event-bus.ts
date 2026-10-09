/**
 * Lightweight in-process event bus.
 *
 * Why: domain handlers (e.g. pairing/claim-session) should not directly know
 * about side-effects like email/notification — they only emit a domain INFO event.
 * Listeners registered separately consume those events. This keeps boundaries clean
 * and lets us add new side-effects (analytics, notifications, etc.) without
 * touching the handler code path.
 *
 * Scope: deliberately minimal. No DI container, no persistent queue.
 * Fire-and-forget delivery per handler. Errors in one handler do NOT
 * affect other handlers for the same event.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Synchronous emit() that schedules each handler asynchronously. Vercel-aware:
 * uses runAfterResponse() so on serverless (Vercel) the lambda waits for
 * handlers to complete via waitUntil(). On Node (Render/local) handlers run
 * as floating promises — same semantics as runAfterResponse() floating promise
 * fallback. Type-safety: handler payload is keyed off APP_EVENTS.INFO.PAIRING
 * (and any other namespace explicitly registered in `InfoEventPayloadMap`).
 *
 * Adding a new event type:
 *  1) Add the INFO event in APP_EVENTS (.shared-kernel/domain/events/app-events.const.ts).
 *  2) Add a payload entry in `InfoEventPayloadMap` below.
 *  3) Create a listener in event-listeners/ and register via subscribeToInfoEvent().
 */

import type { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { runAfterResponse } from '@app/runtime/run-after-response';

// ── Payload map ──────────────────────────────────────────────────────────────
// Each entry maps INFO event name → typed payload contract.
// Listeners receive `payload: InfoEventPayloadMap[E]`. Emitters must satisfy it.

export type InfoEventPayloadMap = {
  // Stały-only (2026-07-12): nowa prośba o połączenie → mail do stylistki.
  [APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT]: {
    stylistUserId: string;
    stylistEmail: string;
    stylistName: string | null;
    clientName: string | null;
  };
  [APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED]: {
    stylistAccountId: string;
    stylistUserId: string;
    stylistEmail: string;
    stylistName: string | null;
    clientUserId: string;
    clientName: string | null;
    claimedAt: Date;
  };
  // Sesja inspiracji udostępniona stylistce (2026-07-12) → mail; bez niego
  // jedyny sygnał to licznik na dashboardzie widoczny dopiero po otwarciu apki.
  // Payload niesie TYLKO id — e-mail stylistki (PII) rozwiązuje listener
  // przez lookup, więc PII nie krąży po szynie zdarzeń (parytet z tym, że
  // share-RESPONSE też nie wynosi e-maila stylistki do klientki). sessionId
  // niesie deep-link CTA (mail → konkretna sesja w skrzynce stylistki) ORAZ
  // różnicuje klucz dedup maili (dwie różne sesje = różny appUrl w vars →
  // brak kolizji, gdy dwie klientki o tym samym imieniu dzielą w oknie 60 s).
  [APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARED]: {
    stylistAccountId: string;
    clientName: string | null;
    sessionId: string;
  };
};

export type InfoEventName = keyof InfoEventPayloadMap;

export type EventHandler<E extends InfoEventName> = (
  payload: InfoEventPayloadMap[E]
) => Promise<void>;

// ── Internal store ───────────────────────────────────────────────────────────

type HandlerEntry = {
  // Stored as the broadest handler type — narrowed back at invoke time via
  // the public subscribe/emit signatures. Avoids `any` while keeping the
  // internal map homogeneous across event names.
  handler: EventHandler<InfoEventName>;
};

// DECISION (nie usuwaj tego komentarza):
// Rejestr MUSI żyć na globalThis (ten sam wzorzec co `__primaryDbAvailabilityState`
// w db-availability.state.ts i `global.globalPrisma` w prisma.adapter.ts). Next
// bundluje ten moduł OSOBNO dla `instrumentation.ts` i dla `pages/api/**`, więc
// module-level `new Map()` dawał DWA niezależne rejestry: subskrypcje rejestrowały
// się w kopii instrumentation, a `emit()` z handlera API trafiał w kopię, która
// była pusta na zawsze.
//
// Skutek był niewidoczny i trwały: `emit()` przy pustej liście po prostu wychodził,
// więc trzy maile powiadomień NIGDY nie poszły, a request zwracał 200 — bez wpisu
// w EventLogu, bez FailedEmail, bez zgłoszenia błędu. Zmierzone na bazie dev:
// 59 × PAIR_REQUEST_SENT, 114 × PAIRING_SESSION_CLAIMED, 34 × SESSION_CONTAINER_SHARED
// i ZERO odpowiadających im zdarzeń EMAIL_* (kontrola: powiadomienia komunikatora,
// które omijają magistralę i wołają wysyłkę wprost, mają swoje wpisy).
const globalScope = globalThis as typeof globalThis & {
  __appInfoEventHandlers?: Map<InfoEventName, HandlerEntry[]>;
};

const handlers: Map<InfoEventName, HandlerEntry[]> =
  (globalScope.__appInfoEventHandlers ??= new Map<
    InfoEventName,
    HandlerEntry[]
  >());

// ── Public API ───────────────────────────────────────────────────────────────

const subscribe = <E extends InfoEventName>(
  event: E,
  handler: EventHandler<E>
): (() => void) => {
  const list = handlers.get(event) ?? [];
  const normalized = handler as EventHandler<InfoEventName>;

  // DECISION (nie usuwaj tego komentarza):
  // Rejestracja MUSI być idempotentna, odkąd rejestr żyje na globalThis. Wcześniej
  // ponowna ewaluacja modułu dostawała ŚWIEŻĄ mapę, więc powtórne wpięcie listenerów
  // było nieszkodliwe. Teraz mapa przeżywa moduł, więc druga ewaluacja
  // `instrumentation.ts` dopisałaby TE SAME handlery drugi raz i każde powiadomienie
  // poszłoby podwójnie — czyli lekarstwo na martwą magistralę zamieniłoby się
  // w dublowanie maili. Tożsamość funkcji wystarcza: listenery to moduł-level
  // referencje, nie domknięcia tworzone per wywołanie.
  const alreadyRegistered = list.some(e => e.handler === normalized);
  if (alreadyRegistered) {
    return () => undefined;
  }

  const entry: HandlerEntry = { handler: normalized };
  list.push(entry);
  handlers.set(event, list);

  return () => {
    const current = handlers.get(event);
    if (!current) {
      return;
    }
    const next = current.filter(e => e !== entry);
    if (next.length === 0) {
      handlers.delete(event);
    } else {
      handlers.set(event, next);
    }
  };
};

const emit = <E extends InfoEventName>(
  event: E,
  payload: InfoEventPayloadMap[E]
): void => {
  const list = handlers.get(event);
  if (!list || list.length === 0) {
    // Cisza w tym miejscu ukrywała awarię przez cały czas życia magistrali:
    // „nikt nie słucha" wygląda dokładnie tak samo jak „nie ma czego wysyłać".
    // Zgłaszamy głośno, bo każdy `emit` w tym kodzie ma swojego odbiorcę —
    // brak handlera oznacza rozjechany rejestr, nie zdarzenie bez znaczenia.
    reportIssueBackend({
      namespace: 'EVENT_BUS_NO_HANDLER',
      message: `Zdarzenie ${event} nie ma ani jednego subskrybenta — efekt uboczny (mail/powiadomienie) NIE zostanie wykonany`,
      payload: { event, registeredEvents: [...handlers.keys()] },
      mode: 'error',
    });
    return;
  }

  for (const entry of list) {
    // Each handler runs independently — one failure does not affect others.
    // runAfterResponse: on Vercel keeps the lambda alive (waitUntil); elsewhere
    // floats the promise. We cast payload to the broad map type because the
    // generic narrowing only holds at the call boundary.
    runAfterResponse(async () => {
      try {
        await entry.handler(payload as InfoEventPayloadMap[InfoEventName]);
      } catch (error) {
        reportIssueBackend({
          namespace: 'EVENT_BUS_HANDLER_ERROR',
          message: `Handler for ${event} threw`,
          payload: { event, error },
          mode: 'error',
        });
      }
    });
  }
};

export const eventBus = {
  emit,
  subscribe,
} as const;

/** Convenience emitter — same as eventBus.emit, kept for readability. */
export const emitInfoEvent = <E extends InfoEventName>(
  event: E,
  payload: InfoEventPayloadMap[E]
): void => eventBus.emit(event, payload);

/** Convenience subscriber — same as eventBus.subscribe, kept for readability. */
export const subscribeToInfoEvent = <E extends InfoEventName>(
  event: E,
  handler: EventHandler<E>
): (() => void) => eventBus.subscribe(event, handler);
