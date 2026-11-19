// main/src/UI/features/admin/hooks/admin-retry-policy.ts
// Shared TQ retry helper for admin queries — skip retry on permission/not-found errors.

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { isIOError } from '../../../../application/http/io';

/**
 * DECISION: HTTPError carries no statusCode, only `event` (EVENT_INFO_TYPE). Events that mean "no
 * point retrying" map to false: ACCESS_DENIED_INFO (403), UNAUTHORIZED (401), NOT_FOUND (404).
 * Other errors get at most 2 retries (the TanStack default is 3; admin queries are expensive, so do
 * not spam the backend).
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
