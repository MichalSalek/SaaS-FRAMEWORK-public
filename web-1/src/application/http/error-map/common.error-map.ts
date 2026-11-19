// Common errors (kernel `CommonError`): auth, validation, persistence, captcha, shared not-found.
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { CommonError } from '@kernel/application/common-errors.types';
import { AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS } from '@kernel/application/auth/auth.config';
import {
  respondAccountNotFound,
  respondAuthUnavailable,
  respondConflict,
  respondForbidden,
  respondGeneralError,
  respondNotFound,
  respondQueryFailure,
  respondUnauthorized,
  respondValidationFailed,
} from '../http.responses.utils';
import type { ErrorResponderMap } from './error-map.types';

export const commonErrorMap = {
  AUTH_UNAVAILABLE: res =>
    // 503 + Retry-After, never 401/403: the server could not CHECK the credentials, so the client
    // must keep its token and retry (DECISION at AuthUnavailableError in the kernel). `stage` is
    // reported at the source and deliberately not echoed.
    respondAuthUnavailable(res, AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS),

  ACCOUNT_NOT_FOUND: (res, error) =>
    respondAccountNotFound(res, { accountId: error.accountId }),

  UNAUTHORIZED: (res, error) => {
    // DECISION: MISSING_PERMISSION and WRONG_ACCOUNT_TYPE concern a LOGGED-IN user (token
    // recognised, role/permission missing), so they map to 403 like request.middleware. 401
    // stays for "credentials did not resolve"; the front treats every 401 as a dead token and
    // logs out. The event stays UNAUTHORIZED.
    if (error.reason === 'MISSING_PERMISSION') {
      return respondForbidden(
        res,
        {
          reason: error.reason,
          requiredPermission: error.requiredPermission,
        },
        APP_EVENTS.INFO.USER.UNAUTHORIZED
      );
    } else if (error.reason === 'WRONG_ACCOUNT_TYPE') {
      return respondForbidden(
        res,
        {
          reason: error.reason,
          requiredAccountType: error.requiredAccountType,
        },
        APP_EVENTS.INFO.USER.UNAUTHORIZED
      );
    } else if (error.reason === 'ACCOUNT_INACTIVE') {
      return respondForbidden(res, {
        reason: error.reason,
      });
    } else {
      return respondUnauthorized(res, { reason: error.reason });
    }
  },

  VALIDATION_ERROR: (res, error) =>
    respondValidationFailed(res, {
      field: error.field,
      message: error.message,
    }),

  DATABASE_ERROR: (res, error) => {
    // F14 dedup: logged server-side at the source (databaseFailure captures operation + cause).
    // The client gets an opaque 500, never the function name or the underlying cause (info leak),
    // identical to EXTERNAL_SERVICE_ERROR. The one refinement: a request-attributable DB failure
    // (DatabaseError.reason, see classifyQueryFailure) is not a server fault → 409/400, still
    // payload-free.
    if (error.reason !== undefined) {
      return respondQueryFailure(res, error.reason);
    }
    return respondGeneralError(res, undefined);
  },

  // Logged server-side at the source (externalServiceFailure); opaque 500 like DATABASE_ERROR.
  EXTERNAL_SERVICE_ERROR: res => respondGeneralError(res, undefined),

  SERIALIZATION_CONFLICT: res =>
    // DECISION: a transient Postgres 40001 (lost Serializable write race) is a 409 with its own
    // event, not a 429: nothing exceeded a limit and the competing write has already committed, so
    // an immediate retry by the user can succeed. No Retry-After: there is no window to wait out,
    // and the header would invite clients to replay a non-idempotent mutation on a timer. The
    // front never replays a mutation (`mutations.retry: false`); the person repeats it after the
    // message. No payload: the conflict carries no client-safe detail.
    respondConflict(
      res,
      APP_EVENTS.INFO.APPLICATION.CONCURRENT_CHANGE_CONFLICT,
      undefined
    ),

  CAPTCHA_VERIFICATION_FAILED: res =>
    // 403: anti-bot (Turnstile) failed: missing token, negative CF verdict, or fail-closed infra
    // error (turnstile.verify.ts DECISION). SECURITY: error.reason (CF codes / 'missing-token' /
    // 'siteverify-*') is deliberately NOT echoed; it would coach a bot on which bypass got
    // furthest. Infra failures are reported at the source.
    respondForbidden(
      res,
      undefined,
      APP_EVENTS.INFO.PUBLIC.CAPTCHA_VERIFICATION_FAILED
    ),

  STYLIST_NOT_FOUND: (res, error) =>
    respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {
      stylistAccountId: error.stylistAccountId,
    }),

  ANNOUNCEMENT_NOT_FOUND: (res, error) =>
    respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {
      announcementId: error.announcementId,
    }),
} satisfies ErrorResponderMap<CommonError>;
