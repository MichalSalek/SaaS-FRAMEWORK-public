// Messaging errors (kernel `MessagingError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { MessagingError } from '@kernel/domain/messaging/messaging-errors.types';
import {
  respondDomainRateLimited,
  respondForbidden,
  respondNotFound,
} from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';

export const messagingErrorMap = {
  // Anti-enumeration: MESSAGING_PAIR_NOT_FOUND covers BOTH "the pair does not exist" and "the caller
  // is not a party": one 404, so 403-vs-404 does not reveal real pair ids (parity with
  // SUPPORT_THREAD_NOT_FOUND / NOT_AUTHORIZED).
  MESSAGING_PAIR_NOT_FOUND: res =>
    respondNotFound(
      res,
      APP_EVENTS.INFO.MESSAGING.MESSAGING_PAIR_NOT_FOUND,
      undefined
    ),

  MESSAGING_NOT_ALLOWED: res =>
    // The caller IS a party, but the pair is REVOKED, so sending is blocked (403, no mask).
    // Argument order: respondForbidden takes DATA second and the event third, the reverse of
    // respondNotFound/Conflict/TooMany. Swapped arguments compiled silently (the payload is
    // generic), the envelope carried the generic ACCESS_DENIED_INFO and `data` held the event name,
    // so the front lost its translated "messages only in an active connection" text.
    respondForbidden(
      res,
      undefined,
      APP_EVENTS.INFO.MESSAGING.MESSAGING_NOT_ALLOWED
    ),

  MESSAGING_RATE_LIMITED: (res, error) =>
    // The real unlock window is computed by the operation (oldest message in the window); see the
    // DECISION at respondDomainRateLimited.
    respondDomainRateLimited(
      res,
      APP_EVENTS.INFO.APPLICATION.RATE_LIMIT_EXCEEDED_INFO,
      error.retryAfterSeconds
    ),
} satisfies ErrorResponderMap<OwnErrors<MessagingError>>;
