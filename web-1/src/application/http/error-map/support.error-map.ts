// Support thread errors (kernel `SupportError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { SupportError } from '@kernel/domain/support/support-errors.types';
import {
  respondBadRequest,
  respondConflict,
  respondNotFound,
  respondTooManyRequests,
} from '../http.responses.utils';
import type {
  ErrorResponder,
  ErrorResponderMap,
  OwnErrors,
} from './error-map.types';

// SECURITY (anti-enumeration): SUPPORT_THREAD_NOT_AUTHORIZED (a thread that exists but belongs to
// another user) MUST be byte-for-byte indistinguishable from SUPPORT_THREAD_NOT_FOUND, otherwise a
// 403-vs-404 split leaks which thread ids are real (IDOR enumeration). One shared responder
// structurally guarantees the identical 404 status, event and payload ({ threadId }, the caller's
// own input).
// DECISION: the authorization failure is INTENTIONALLY a 404; do not split it back to a 403.
const respondThreadNotFound: ErrorResponder<{ threadId: string }> = (
  res,
  error
) =>
  respondNotFound(res, APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_NOT_FOUND, {
    threadId: error.threadId,
  });

export const supportErrorMap = {
  SUPPORT_THREAD_NOT_FOUND: respondThreadNotFound,
  SUPPORT_THREAD_NOT_AUTHORIZED: respondThreadNotFound,

  SUPPORT_THREAD_CLOSED: (res, error) =>
    respondBadRequest(res, APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_CLOSED, {
      threadId: error.threadId,
    }),

  // An admin acted on a stale thread snapshot: 409, the admin UI refetches and re-decides.
  SUPPORT_THREAD_STALE: (res, error) =>
    respondConflict(res, APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_STALE, {
      threadId: error.threadId,
    }),

  SUPPORT_RATE_LIMITED: res =>
    // Per-user hourly support quota exceeded (create-thread / add-message). 429 back-off, like the
    // other rate-limit paths; the generic RATE_LIMIT_EXCEEDED_INFO event, no payload.
    respondTooManyRequests(
      res,
      APP_EVENTS.INFO.APPLICATION.RATE_LIMIT_EXCEEDED_INFO,
      undefined
    ),
} satisfies ErrorResponderMap<OwnErrors<SupportError>>;
