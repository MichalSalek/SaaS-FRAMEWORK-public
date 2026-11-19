/**
 * In-process bus: a domain handler emits an INFO event instead of calling mail
 * or notifications itself. Fire-and-forget per handler. One handler's error does
 * not stop the others.
 * DECISION: `emit()` is synchronous and schedules each handler through
 * runAfterResponse (waitUntil on Vercel, a floating promise on Node). Payload types
 * live in `InfoEventPayloadMap`. A new event needs an APP_EVENTS.INFO entry, a map
 * entry, and a listener registered with subscribeToInfoEvent().
 */

import type { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { StylistClientMessageSender } from '@kernel/models/db_models.generated.dto';
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
    // Notifications v2: the row's identity (one per pair) and its actor.
    pairId: string;
    clientUserId: string;
  };
  // The stylist accepted the request. Until then the client learned nothing.
  // The listener reads the names.
  [APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_ACCEPTED]: {
    pairId: string;
    clientUserId: string;
    stylistAccountId: string;
    stylistUserId: string;
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
  // A shared inspiration session mails the stylist. Without that mail the only
  // signal is a dashboard counter she sees after opening the app.
  // The payload carries ids only. The listener looks up the stylist's e-mail,
  // so that address does not travel on the bus (the share response also keeps
  // it off the client's payload). sessionId is the deep-link target and splits
  // the mail dedup key, so two sessions do not collide inside the 60s window.
  [APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARED]: {
    stylistAccountId: string;
    clientName: string | null;
    sessionId: string;
    // Notifications v2: actor of the row (soft reference, erased on Art. 17).
    clientUserId: string;
  };
  // Notifications v2: the assigned stylist closed the session after the visit
  // (the handler emits ONLY for that closer; a client closing her own tells nobody).
  [APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CLOSED]: {
    sessionId: string;
    clientAccountId: string;
    stylistAccountId: string;
    closedByUserId: string;
  };
  // Notifications v2: a message that passed the 15-minute send throttle and
  // whose recipient did not mute the conversation (the same gate as the mail,
  // which stays a direct call in the handler). `senderName` is a display name
  // or null, never an e-mail (the mail path may use one; the row must not).
  [APP_EVENTS.INFO.MESSAGING.MESSAGING_MESSAGE_SENT]: {
    pairId: string;
    recipientUserId: string;
    recipientSide: StylistClientMessageSender;
    senderUserId: string;
    senderName: string | null;
  };
  // Notifications v2: a NEW salon invitation (the listener finds the invitee's
  // account by the invitation's e-mail; unknown addresses get the mail only).
  [APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITED]: {
    invitationId: string;
    salonAccountId: string;
  };
  // Notifications v2: somebody joined the owner's team.
  [APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_ACCEPTED]: {
    salonAccountId: string;
    memberUserId: string;
  };
  // Notifications v2: the team replied in a support thread. Emitted only for a
  // thread whose owner still exists (an orphaned thread has nobody to tell).
  [APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED]: {
    threadId: string;
    ownerUserId: string;
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

// DECISION: the registry MUST live on globalThis, not in a module-level Map: Next bundles this
// module separately for instrumentation.ts and pages/api (mechanism:
// web-1/src/application/db/db-availability.state.ts). The failure is silent: subscriptions landed
// in one copy while emit() hit an empty one, so notification mails never went out while the request
// returned 200.
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

  // DECISION: registration MUST be idempotent now that the registry lives on globalThis. A second
  // evaluation of `instrumentation.ts` would append the same handlers again and every
  // notification would go out twice. Function identity suffices: listeners are module-level
  // references, not per-call closures.
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
    // Silence here hid a failure for the whole life of the bus. "Nobody is
    // listening" looks exactly like "nothing to send". Report it. Every `emit`
    // in this code has a listener, so a missing handler means a split registry.
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

/** Durable callers await required subscribers and retain their outbox on failure. */
export const emitInfoEventAndWait = async <E extends InfoEventName>(
  event: E,
  payload: InfoEventPayloadMap[E]
): Promise<void> => {
  const list = handlers.get(event);
  if (!list?.length) {
    throw new Error(`Required event subscriber missing: ${event}`);
  }
  const outcomes = await Promise.allSettled(
    list.map(entry =>
      entry.handler(payload as InfoEventPayloadMap[InfoEventName])
    )
  );
  const errors = outcomes.flatMap(result =>
    result.status === 'rejected' ? [result.reason] : []
  );
  if (errors.length) {
    throw new AggregateError(
      errors,
      `Required event delivery failed: ${event}`
    );
  }
};

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
