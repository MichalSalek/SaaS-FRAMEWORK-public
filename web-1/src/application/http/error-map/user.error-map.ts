// User errors (kernel `UserError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { UserError } from '@kernel/domain/user-and-account/user-errors.types';
import {
  respondBadRequest,
  respondConflict,
  respondTooManyRequests,
  respondUserNotFound,
} from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';

export const userErrorMap = {
  USER_NOT_FOUND: res => respondUserNotFound(res, {}),

  USER_EMAIL_ALREADY_IN_USE: res =>
    // SECURITY: do not echo the email back. Reached only on the confirm-side P2002 race
    // (confirmEmailChange_IO), NOT an enumeration oracle: request-side enumeration is
    // closed in changeUserEmail_IO (neutral success response).
    respondBadRequest(
      res,
      APP_EVENTS.INFO.USER.EMAIL_ALREADY_EXISTS,
      undefined
    ),

  EXPORT_RATE_LIMITED: (res, error) =>
    respondTooManyRequests(
      res,
      APP_EVENTS.INFO.USER.USER_DATA_EXPORT_RATE_LIMITED,
      {
        lastExportAt: error.lastExportAt,
        nextAvailableAt: error.nextAvailableAt,
      }
    ),

  USER_HAS_ACTIVE_SUBSCRIPTION: (res, error) =>
    respondConflict(
      res,
      APP_EVENTS.INFO.USER.CANNOT_DISABLE_ACTIVE_SUBSCRIPTION,
      {
        userId: error.userId,
        subscriptionStatus: error.subscriptionStatus,
      }
    ),

  ACCOUNT_NOT_RECOVERABLE: res =>
    // ADRR Model A: reactivation rejected, the account is not RECOVERABLE (expired window /
    // admin ban / already active). 409. userId NOT echoed: the caller acts on her own session id.
    respondConflict(
      res,
      APP_EVENTS.INFO.USER.ACCOUNT_REACTIVATION_FAILED,
      undefined
    ),
} satisfies ErrorResponderMap<OwnErrors<UserError>>;
