// main/src/UI/features/admin/hooks/admin-retry-policy.ts
// Shared TQ retry helper for admin queries — skip retry on permission/not-found errors.

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { isIOError } from '../../../../application/http/io';

/**
 * DECISION (nie usuwaj tego komentarza):
 * HTTPError nie propaguje statusCode — tylko `event` (EVENT_INFO_TYPE). Mapujemy
 * eventy "no point retrying" na false: ACCESS_DENIED_INFO (403), UNAUTHORIZED (401),
 * NOT_FOUND (404). Pozostałe błędy → max 2 retries (default TQ to 3 — admin queries
 * są drogie, ograniczamy bez sensu spamić backend).
 */
const NON_RETRYABLE_EVENTS: ReadonlySet<string> = new Set<string>([
  APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
  APP_EVENTS.INFO.USER.UNAUTHORIZED,
  APP_EVENTS.INFO.APPLICATION.NOT_FOUND,
]);

export const shouldRetryAdminQuery = (
  failureCount: number,
  error: Error
): boolean => {
  const event = isIOError(error) ? error.httpError.event : undefined;
  if (event !== undefined && NON_RETRYABLE_EVENTS.has(event)) {
    return false;
  }
  return failureCount < 2;
};
