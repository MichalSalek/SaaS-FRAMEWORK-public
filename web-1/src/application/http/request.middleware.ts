/**
 * Main HTTP Request Handler Middleware, the PRIMARY middleware for all API endpoints.
 *
 * Lifecycle: 1 CORS, 2 rate limit, 3 method check, 4 body read + null-byte guard,
 * 5 authN/authZ then the account-state and impersonation gates, 6 payload validation (after
 * auth on purpose: no info leakage), 7 routing-permissions interceptor, 8 business logic,
 * 9 lazy maintenance. Errors thrown anywhere go to the centralized error handling.
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

  // Request body parser. Its success output (`__data`) is the ONLY payload the business logic
  // receives; the request body itself never reaches it. Endpoints without a body pass NO_VALIDATION.
  validationFunction: ValidationFunction<T>;

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
    validationFunction,
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
      // DECISION: 405 carries `Allow` and the response envelope, through the canonical helper.
      // This gate rejects a wrong verb on ~150 CQRS routes; a bare `res.status(405).send(null)`
      // had no `Allow` (REQUIRED by RFC 9110 §15.5.6), no `{event,data}` body (the API's only
      // response contract) and lost the default `Cache-Control: no-store`. The method in `Allow`
      // is not guessed: `contestedHTTPMethod` comes from `API_HTTP_METHODS` in the kernel (the SSOT
      // that `tests/audit/handler-method-consistency.sh` guards). OPTIONS is added because this
      // function also answers preflight a few steps above. Event ACCESS_DENIED_INFO: the kernel
      // has no dedicated METHOD_NOT_ALLOWED, the status carries the semantics.
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
    // The raw body is only INPUT to the validator (step 6); the handler receives the parser's output.
    // A non-plain-object body (JSON `null`, array, primitive) is validated as `{}` inside the kernel
    // validator (zodValidate), so missing required fields get a clean 400, never a 500.
    const rawBody: unknown = req.body;

    // 4b. NULL-BYTE INPUT GUARD
    //
    // DECISION: the null-byte (U+0000) guard (null-byte-guard.helper.ts) is screened HERE, the
    // single boundary for every CQRS route, not in defineHandler: defineHandler always delegates
    // to this middleware, but routes that call HTTPRequestHandlerMiddleware directly would
    // bypass a guard placed there, and a NUL reaching Prisma is an unmapped 500. Placement: after
    // body parse (a GET query promoted by defineHandler's mapRequest is already in req.body) and
    // BEFORE auth/validation/operation, answered as a uniform 400 VALIDATION_FAILED. Raw/webhook
    // routes (withPublicHandler/withRawSecretHandler) bypass this middleware and keep their own
    // screen in define-raw-handler.
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
      // DECISION: an UNAVAILABLE resolution (the session, user or plan read failed on OUR side)
      // answers 503 AUTH_UNAVAILABLE before anything else runs. Degrading it to the anonymous
      // user produced 401 LOGIN_FIRST, and the client deletes a token on LOGIN_FIRST: a database
      // blip logged people out. It never continues as anonymous, so it cannot grant access either.
      const resolution = await getCurrentUser_IO({ req, res });
      if (resolution.status === 'UNAVAILABLE') {
        mapErrorToResponse(res, {
          type: 'AUTH_UNAVAILABLE',
          stage: resolution.stage,
        });
        return;
      }
      currentUserOutput = resolution.output;
      setCurrentRequestUserId(currentUserOutput.currentUser?.id ?? null);
      const resolvedSession = currentUserOutput.session;
      const resolvedUserId = currentUserOutput.currentUser?.id;
      if (resolvedSession && resolvedUserId) {
        // Every audit row written during an impersonated session names the admin
        // (recordAuditEvent_IO reads this), so no action reads as the user's own act.
        setCurrentRequestImpersonationResolver(async () => {
          // Never rejects: the result is memoised per request, so a rejected
          // lookup would make every later audit write in it throw and vanish.
          // A failed lookup writes the row unstamped instead.
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

      if (
        !permissionCheck.hasPermission &&
        permissionCheck.reason === 'UNAVAILABLE'
      ) {
        // The custom-role permission read failed: not a refusal (403) and never a grant.
        mapErrorToResponse(res, {
          type: 'AUTH_UNAVAILABLE',
          stage: 'PERMISSIONS',
        });
        return;
      }

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
    // DECISION: the handler gets `validationResult.__data`, the parser's output (trimmed, coerced,
    // defaulted, unknown keys stripped), never the request body cast to T (owner). Passing the body back would let a handler read a key the validator never checked
    // and would drop every transform the schema applies. Canon: validation.types.ts / validation.zod.ts.
    const validationResult = validationFunction(rawBody);
    if (!validationResult.__isValid) {
      res.status(asStatusCode(400)).send(
        getInfoEventWithPayloadDTO({
          event: APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
          data: getErrorDTOWithoutValidationFlag(validationResult),
        })
      );
      return;
    }
    const payload: T = validationResult.__data;

    // 7. INTERCEPTORS
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
    await businessLogic(payload, currentUserOutput, userMetadata);

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
