// Email token and unsubscribe errors (kernel `EmailError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EmailError } from '@kernel/domain/email/email-errors.types';
import { respondBadRequest, respondNotFound } from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';

export const emailErrorMap = {
  EMAIL_INVALID_UNSUBSCRIBE_TOKEN: res =>
    respondBadRequest(res, APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED, {
      reason: 'Invalid unsubscribe token',
    }),

  EMAIL_UNSUBSCRIBE_TOKEN_EXPIRED: res =>
    respondBadRequest(res, APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED, {
      reason: 'Unsubscribe token expired',
    }),

  // SECURITY: do not echo userId; it prevents user enumeration on public endpoints.
  EMAIL_USER_NOT_FOUND: res =>
    respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {}),

  EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE: (res, error) =>
    // 400: unsubscribe requested from a non-unsubscribable (TRANSACTIONAL) category (PKE). An
    // honest 400 instead of a misleading 200 for a no-op. category is safe, non-PII.
    respondBadRequest(res, APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED, {
      reason: 'Transactional emails cannot be unsubscribed',
      category: error.category,
    }),

  EMAIL_CHANGE_INVALID_TOKEN: res =>
    respondBadRequest(
      res,
      APP_EVENTS.INFO.USER.USER_EMAIL_CHANGE_INVALID_TOKEN,
      {
        reason: 'Invalid email change token',
      }
    ),

  DELETE_CONFIRM_INVALID_TOKEN: res =>
    respondBadRequest(res, APP_EVENTS.INFO.USER.USER_DELETE_INVALID_TOKEN, {
      reason: 'Invalid delete confirmation token',
    }),
} satisfies ErrorResponderMap<OwnErrors<EmailError>>;
