/**
 * Main HTTP Request Handler Middleware
 *
 * Orchestrates the complete request lifecycle:
 * 1. CORS validation
 * 2. Rate limiting
 * 3. HTTP method validation
 * 4. Request body read + null-byte input guard
 * 5. Authentication & Authorization (permission check), then the
 *    account-state gate and the impersonation gate
 * 6. Payload validation (after auth on purpose: no info leakage)
 * 7. Interceptors (user entity, routing permissions)
 * 8. Business logic execution
 * 9. Lazy maintenance
 * Errors thrown anywhere go to the centralized error handling.
 *
 * This is the PRIMARY middleware for all API endpoints.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { HTTPMethod } from '@kernel/domain/http/http.config';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import type { UserMetadata } from '@kernel/models/db_models.manual.dto';
import {
  assertType,
  hasEvent,
  isEventInfoNarrower,
} from '@kernel/models/type_narrowing';
import { EVENTS_POLICY } from '@kernel/policies/events.policy';
import type { ValidationFunction } from '@kernel/policies/validation.policy';
import { getErrorDTOWithoutValidationFlag } from '@kernel/policies/validation.policy';
import type { EVENT_COMMANDS_AND_QUERIES_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import {
  isUserShouldBeOnThisRoutePermissionsInterceptor,
  currentUserEntityInterceptor,
  getCurrentUser_IO,
  getCurrentUserUndefinedReturnObject,
} from '@app/interceptors/domain-interceptors';
import type { GetCurrentUserOutput } from '@app/interceptors/domain-interceptors';
import { isAllowedOrigin, setCORSHeaders } from '@app/cors/cors.middleware';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  setCurrentRequestImpersonationResolver,
  setCurrentRequestUserId,
} from '@app/http/request-context';
import {
  enforceImpersonationGate_IO,
  findImpersonatingAdminBySession_IO,
  isSensitiveCommand,
} from '@app/auth/admin-impersonation.utils';
import { mapErrorToResponse } from './error-mapper';
import { checkPermission } from '@app/permissions/permissions.init';
import { isAccountStateActionAllowed } from './account-state-guard';
import { containsNullByte } from './null-byte-guard.helper';
import {
  respondMethodNotAllowed,
  respondValidationFailed,
} from './http.responses.utils';
import {
  getInfoEventWithPayloadDTO,
  asStatusCode,
  getKnownRequestHeaders,
  getGenericErrorWithDebuggerDTO,
} from './http.utils.api';
import { withRateLimitCheck } from './rate-limit.middleware';
import { getPrimaryDatabaseAvailability } from '@app/db/db-availability.state';
import { classifyQueryFailure } from '@app/db/prisma-error';
import { respondQueryFailure } from './http.responses.utils';
import { scheduleMaintenanceSweeps } from '@app/interceptors/schedule-maintenance-sweeps';

type HTTPRequestHandlerMiddlewareConfig<T> = {
  // Allowed methods for this API call.
  contestedHTTPMethod: HTTPMethod;

  // CQRS event name for identification.
  eventName: EVENT_COMMANDS_AND_QUERIES_TYPE;

  // Request body validation.
  validationFunction?: ValidationFunction;

  // Disable generic permission get-current.
  // Makes `undefined` @currentUser param in businessLogic prop.
  AUTHENTICATION_CHECK_ENABLED?: boolean;

  // Main logic fire place.
  businessLogic: (
    reqBody: T,
    currentUserOutput: GetCurrentUserOutput,
    userMetadata: UserMetadata
  ) => Promise<void>;
};

/**
 * Main HTTP Request Handler Middleware
 * @template T - Request body type
 */
export const HTTPRequestHandlerMiddleware = async <T = unknown>(
  req: NextApiRequest,
  res: NextApiResponse,
  config: HTTPRequestHandlerMiddlewareConfig<T>
): Promise<void> => {
  const {
    contestedHTTPMethod,
    eventName,
    validationFunction = () => ({ __isValid: true }),
    businessLogic,
    AUTHENTICATION_CHECK_ENABLED = true,
  } = config;
  const primaryUseCountAtRequestStart =
    getPrimaryDatabaseAvailability().successfulUseCount;

  try {
    /*
      TABLE OF CONTENTS:
      1. CORS VALIDATE
      2. RATE LIMIT CHECK
      3. HTTP METHOD VALIDATE
      4. GET REQUEST BODY
      4b. NULL-BYTE INPUT GUARD (uniform 400 for the whole NUL class)
      5. PERMISSION VALIDATE (auth before validation — prevents info leakage)
      5b. ACCOUNT-STATE GATE (ADRR §13.1 — allowlist-by-state for inactive accounts)
      6. PAYLOAD VALIDATION
      7. INTERCEPTORS
      8. GET REQUEST HEADERS
      9. BUSINESS LOGIC FIRE
      10. LAZY MAINTENANCE (only after accepted application traffic)
    */

    // 1. CORS VALIDATE
    //
    if (!isAllowedOrigin({ req, res })) {
      res.status(asStatusCode(406)).send('Origin not allowed');
      return;
    }

    setCORSHeaders({ req, res });

    if (req.method === 'OPTIONS') {
      res.status(asStatusCode(200)).end();
      return;
    }

    // 2. RATE LIMIT CHECK
    //
    if (!withRateLimitCheck(req, res)) {
      return;
    }

    // 3. HTTP METHOD VALIDATE
    //
    if (req.method?.toUpperCase() !== contestedHTTPMethod?.toUpperCase()) {
      // DECISION (nie usuwaj tego komentarza) — 405 Z `Allow` I Z KOPERTĄ, przez
      // kanoniczny helper:
      // ta bramka odrzuca zły czasownik na ~150 trasach CQRS, a robiła to jako
      // `res.status(405).send(null)` — odpowiedź bez `Allow`, bez ciała i poza
      // `respondInfo`, więc traciła też domyślne `Cache-Control: no-store`. Brak
      // `Allow` łamie RFC 9110 §15.5.6 (przy 405 nagłówek jest WYMAGANY) i nie mówi
      // klientowi, czym ponowić; puste ciało zamiast koperty `{event,data}` wyłamywało
      // te trasy z jedynego kontraktu odpowiedzi, jaki ma to API — klient nie miał
      // czego sparsować, a `send(null)` wywracał się nawet w harnessie testowym.
      // Metoda w `Allow` NIE jest zgadywana: `contestedHTTPMethod` pochodzi wprost
      // z `API_HTTP_METHODS` w jądrze (defineHandler przekazuje `method:`), więc to ten
      // sam SSOT, którego pilnuje `bash tests/audit/handler-method-consistency.sh`. OPTIONS dokładamy,
      // bo ta sama funkcja odpowiada na preflight kilka kroków wyżej — pominięcie go
      // kazałoby przeglądarce wnioskować, że preflight jest niewspierany.
      // Event: ACCESS_DENIED_INFO — nie ma w jądrze dedykowanego METHOD_NOT_ALLOWED,
      // a to ten sam wybór, co w `salon/staff` i na raw-edge'ach; semantykę niesie
      // status, koperta potrzebuje tylko poprawnego INFO-eventu.
      res.setHeader('Allow', `${contestedHTTPMethod.toUpperCase()}, OPTIONS`);
      respondMethodNotAllowed(
        res,
        APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
        { allowed: contestedHTTPMethod.toUpperCase() }
      );
      return;
    }

    // 4. GET REQUEST BODY
    //
    // DECISION (nie usuwaj tego komentarza):
    // Coalesce a non-plain-object body (literal JSON `null`, array, or primitive) to {}
    // BEFORE validation/businessLogic. Validators do `!typedData.x` and handlers read
    // `body.x`; a null/array/primitive body throws on property access → unmapped 500
    // GENERAL_ERROR (ERR500-NULLBODY-01 — hit 12+ POST routes). Treating it as an empty
    // object lets the validator reject missing required fields with a clean 400 (parity
    // with the null-byte input guard); endpoints with no required fields are unaffected.
    const rawBody: unknown = req.body;
    const body = (
      rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
        ? rawBody
        : {}
    ) as T;

    // 4b. NULL-BYTE INPUT GUARD
    //
    // DECISION (nie usuwaj tego komentarza):
    // Null-byte (U+0000) input guard — defense-in-depth (null-byte-guard.helper.ts).
    // Screened HERE (the SINGLE boundary for every CQRS route) instead of in
    // defineHandler: defineHandler always delegates to this middleware, but four
    // prod routes (salon/staff dispatcher, newsletter-confirm/-unsubscribe,
    // email/unsubscribe) call HTTPRequestHandlerMiddleware directly and used to
    // bypass the guard entirely — a NUL in their input reached Prisma as an
    // unmapped 500. Placement: after body parse (raw req.body — a promoted GET
    // query via defineHandler's mapRequest is already in req.body here) and
    // BEFORE auth/validation/operation, so a NUL in any body/query string is
    // rejected as a uniform 400 VALIDATION_FAILED (same respondValidationFailed
    // shape defineHandler used) rather than throwing deep inside a Prisma call.
    // Per-domain validators only check `typeof === 'string'`, so this is the one
    // place that maps the whole null-byte class. Empty/absent input →
    // containsNullByte() is false, so clean requests flow through unchanged.
    // Raw/webhook routes (withPublicHandler/withRawSecretHandler) do NOT pass
    // through this middleware — they keep their own screen in define-raw-handler.
    if (containsNullByte(rawBody) || containsNullByte(req.query)) {
      respondValidationFailed(res, {
        field: 'input',
        message: 'Invalid input',
      });
      return;
    }

    let currentUserOutput: GetCurrentUserOutput =
      getCurrentUserUndefinedReturnObject;

    // 5. PERMISSION VALIDATE (auth before validation — prevents info leakage)
    //
    if (AUTHENTICATION_CHECK_ENABLED) {
      // Authentication:
      currentUserOutput = await getCurrentUser_IO({ req, res });
      setCurrentRequestUserId(currentUserOutput.currentUser?.id ?? null);
      const resolvedSession = currentUserOutput.session;
      const resolvedUserId = currentUserOutput.currentUser?.id;
      if (resolvedSession && resolvedUserId) {
        // Every audit row written during an impersonated session names the admin
        // (recordAuditEvent_IO reads this); before, only become/refresh/switch-back
        // and the sensitive gate did, so everything else read as the user's own act.
        setCurrentRequestImpersonationResolver(async () => {
          // Never rejects: the result is memoised per request, so a rejected
          // lookup would make every later audit write in it throw and vanish.
          // A failed lookup writes the row unstamped instead (closing review s34).
          try {
            const adminId = await findImpersonatingAdminBySession_IO({
              sessionToken: resolvedSession.token,
              currentUserId: resolvedUserId,
            });
            return adminId === resolvedUserId ? null : adminId;
          } catch (error) {
            reportIssueBackend({
              namespace: 'IMPERSONATION_STAMP_LOOKUP_FAILED',
              message:
                'Impersonation lookup failed; audit rows written unstamped',
              payload: error,
              mode: 'warn',
            });
            return null;
          }
        });
      }

      // Authorization: check permission from DB cache (type-safe)
      const roleId =
        currentUserOutput.user?.role_id ?? SystemRoleId.NOT_LOGGED_IN;
      const permissionCheck = await checkPermission({ roleId, eventName });

      if (!permissionCheck.hasPermission) {
        // 401 = not authenticated (no user), 403 = authenticated but forbidden (has user, no permission)
        const statusCode = currentUserOutput.user ? 403 : 401;
        res.status(asStatusCode(statusCode)).json(
          getInfoEventWithPayloadDTO({
            event: currentUserOutput.user
              ? APP_EVENTS.INFO.USER.UNAUTHORIZED
              : APP_EVENTS.INFO.USER.LOGIN_FIRST,
            data: undefined,
          })
        );
        return;
      }

      // TypeScript now knows permissionCheck.eventName exists (type guard benefit)

      // 5b. ACCOUNT-STATE GATE (ADRR §13.1)
      //
      // DECISION (nie usuwaj tego komentarza):
      // SECURITY BOUNDARY — allowlist-by-state, NIE upraszczać. getCurrentUser_IO
      // CELOWO populuje soft-deleted userów (currentUser musi istnieć by reactivate /
      // gdpr-erase działały post-login), więc bez tej bramki konto nieaktywne miałoby
      // pełny dostęp do app. Bramka stoi PO checkPermission (najpierw RBAC — zero info
      // leak nt. stanu konta przed autoryzacją) i odpala TYLKO gdy user jest rozwiązany
      // (anonimowe/publiczne requesty nie mają stanu konta → nie gate'ujemy). Login +
      // logout idą out-of-band przez /api/auth/[...all] i nie przechodzą tędy.
      // Pełna maszyna stanów + allowlisty: account-state-guard.ts.
      if (
        currentUserOutput.currentUser &&
        !isAccountStateActionAllowed({
          currentUser: currentUserOutput.currentUser,
          eventName,
        })
      ) {
        // Authenticated but account state forbids this action → 403 (not 401).
        // Frontend routes the user by the state DTO from get-current
        // (is_active / deleted_at / recovery_available — already exposed).
        res.status(asStatusCode(403)).json(
          getInfoEventWithPayloadDTO({
            event: APP_EVENTS.INFO.USER.USER_DISABLED,
            data: undefined,
          })
        );
        return;
      }
    }

    // 5c. IMPERSONATION GATE — sensitive self-only commands (email change, deletion,
    // consent, payments) from inside an impersonated session: BLOCK + audit, or an
    // explicit override + audit. Central on purpose: identity comes from the session
    // (not a client header) and no handler can forget the call. Canon + DECISIONs:
    // admin-impersonation.utils.ts.
    if (
      currentUserOutput.currentUser &&
      currentUserOutput.session &&
      isSensitiveCommand(eventName)
    ) {
      const gate = await enforceImpersonationGate_IO({
        req,
        command: eventName,
        currentUserId: currentUserOutput.currentUser.id,
        sessionToken: currentUserOutput.session.token,
      });
      if (!gate.success) {
        mapErrorToResponse(res, gate.error);
        return;
      }
    }

    // 6. PAYLOAD VALIDATE
    //
    const validationResult = validationFunction(body);
    if (!validationResult.__isValid) {
      res.status(asStatusCode(400)).send(
        getInfoEventWithPayloadDTO({
          event: APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
          data: getErrorDTOWithoutValidationFlag(validationResult),
        })
      );
      return;
    }

    // 7. INTERCEPTORS
    //
    // ( current user )
    if (currentUserOutput.currentUser) {
      await currentUserEntityInterceptor(currentUserOutput.currentUser);
    }
    //
    // ( routes permission )
    if (
      !isUserShouldBeOnThisRoutePermissionsInterceptor({
        req,
        res,
        ...(currentUserOutput.currentUser && {
          payload: currentUserOutput.currentUser,
        }),
      })
    ) {
      return;
    }

    // 8. GET REQUEST HEADERS
    //
    const { userMetadata } = getKnownRequestHeaders(req);

    // 9. BUSINESS LOGIC FIRE
    //
    // businessLogic otrzymuje GetCurrentUserOutput (pola user/currentUser/session
    // opcjonalne). Handlery wymagające zalogowanego usera zawężają kontekst przez
    // requireAuthenticatedContext (cast-free guard, rzuca LOGIN_FIRST → 401).
    // Handlery auth-OFF / publiczne auth-ON czytają pola jako optional (?.).
    await businessLogic(body, currentUserOutput, userMetadata);

    // 10. LAZY MAINTENANCE
    // Scheduler additionally verifies that the primary pool completed a use
    // while this request was in flight. Auth-off/non-DB traffic cannot wake Postgres.
    scheduleMaintenanceSweeps(primaryUseCountAtRequestStart);
  } catch (error) {
    // CENTRALIZED ERROR HANDLING - one place for all unhandled errors
    // A THROWN query failure caused by the request (unique race, dangling FK, value the
    // DB refuses, e.g. NUL → 22021) gets the same 409/400 as a returned one through
    // databaseFailure; a DB call outside any try must not turn bad input into a 500.
    const queryFailureReason = classifyQueryFailure(error);
    reportIssueBackend({
      namespace: eventName,
      message: `Unhandled error in ${eventName}`,
      payload: {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        endpoint: req.url,
        method: req.method,
        queryFailureReason,
      },
      mode: queryFailureReason === null ? 'error' : 'warn',
    });

    if (hasEvent(error) && EVENTS_POLICY.utils.IS_INFO_EVENT(error.event)) {
      res.status(asStatusCode(401)).json(
        getGenericErrorWithDebuggerDTO({
          event: assertType(
            error.event,
            isEventInfoNarrower,
            'error.event in HTTPRequestHandlerMiddleware'
          ),
          error,
        })
      );
      return;
    }
    if (queryFailureReason !== null) {
      respondQueryFailure(res, queryFailureReason);
      return;
    }
    res.status(asStatusCode(500)).json(
      getGenericErrorWithDebuggerDTO({
        event: APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR,
        error,
      })
    );
  }
};
