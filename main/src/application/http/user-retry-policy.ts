// main/src/application/http/user-retry-policy.ts
// Shared TQ retry helper for default user queries — skip retry on permission/not-found/validation errors.
// Used as default in queryClient.config.ts (DD3-F4).

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import type { IOError } from './toPromise.adapter';

/**
 * DECISION (nie usuwaj tego komentarza):
 * HTTPError nie propaguje statusCode — tylko `event` (EVENT_INFO_TYPE). Mapujemy
 * eventy "no point retrying" na false: ACCESS_DENIED_INFO (403), UNAUTHORIZED (401),
 * LOGIN_FIRST (401), NOT_FOUND (404), USER_NOT_FOUND (404), ACCOUNT_NOT_FOUND (404),
 * VALIDATION_FAILED (400). Pozostałe (network, 500, transient) → max 1 retry.
 *
 * Default queries retry: false zamieniony na shouldRetryUserQuery — pojedyncza retransmisja
 * po krótkich błędach (Capacitor WebView jest podatne na chwilowe brakuje sieci po
 * wakeup z background; staleTime=60s już amortyzuje, ale 1 retry zapewnia że
 * pierwszy refetch po app resume nie pokazuje błędu jeśli sieć wraca w drugiej próbie).
 */
const NON_RETRYABLE_EVENTS: ReadonlySet<EVENT_INFO_TYPE> =
  new Set<EVENT_INFO_TYPE>([
    APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
    APP_EVENTS.INFO.APPLICATION.NOT_FOUND,
    APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
    APP_EVENTS.INFO.USER.UNAUTHORIZED,
    APP_EVENTS.INFO.USER.LOGIN_FIRST,
    APP_EVENTS.INFO.USER.USER_NOT_FOUND,
    APP_EVENTS.INFO.ACCOUNT.ACCOUNT_NOT_FOUND,
  ]);

export const shouldRetryUserQuery = (
  failureCount: number,
  error: Error
): boolean => {
  const event = (error as IOError<unknown>).httpError?.event;
  if (event !== undefined && NON_RETRYABLE_EVENTS.has(event)) {
    return false;
  }
  return failureCount < 1; // max 1 retry
};
