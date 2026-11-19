import type { NextApiResponse } from 'next';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { HTTPStatus } from '@kernel/domain/http/http.config';
import type { DatabaseFailureReason } from '@kernel/application/common-errors.types';
import { getInfoEventWithPayloadDTO, asStatusCode } from './http.utils.api';
import { assertResponseShape } from './response-assert';

/**
 * A `NextApiResponse` branded with the handler's declared RESPONSE DTO.
 *
 * DECISION: with `defineHandler<TReq, TRes>` the handler's `res` carries this phantom brand and
 * `respondSuccess`/`respondCreated` REQUIRE `data` to match `TRes` at compile time (the contract
 * is type-enforced, not just annotated). The brand is a contravariant phantom function (never set
 * at runtime) so `TRes` is inferred from `res`, not from `data`. An UNBRANDED `NextApiResponse`
 * infers `TRes = unknown`, so legacy call sites and the error responders (which carry an error
 * payload, not the success DTO) stay back-compatible.
 */
export type TypedApiResponse<TRes> = NextApiResponse & {
  readonly __responseBrand?: (value: TRes) => void;
};

/**
 * DECISION: default `Cache-Control: no-store` on all API responses. The JSON envelope carries
 * user-specific or security-sensitive content, and without an explicit header intermediaries (CDN,
 * proxy, bfcache) could cache it (stale auth, info leak). Public-cacheable endpoints (sitemap,
 * llms.txt, public snapshots) opt in by setting their own Cache-Control; we set the default only
 * when the header is missing.
 */
const ensureDefaultCacheControl = (res: NextApiResponse): void => {
  if (res.getHeader('Cache-Control') === undefined) {
    res.setHeader('Cache-Control', 'no-store');
  }
};

export const respondInfo = <DataPayload>(
  res: NextApiResponse,
  statusCode: HTTPStatus,
  event: EVENT_INFO_TYPE,
  data: DataPayload
) => {
  assertResponseShape(event, data);
  ensureDefaultCacheControl(res);
  res.status(asStatusCode(statusCode)).json(
    getInfoEventWithPayloadDTO<DataPayload>({
      event,
      data,
    })
  );
};

export const respondAccountNotFound = <DataPayload>(
  res: NextApiResponse,
  data: DataPayload
) => {
  // 404 — resource (account) does not exist. Earlier 403 was misleading and
  // collided with the "RBAC denied" semantic used in tests.
  respondInfo(res, 404, APP_EVENTS.INFO.ACCOUNT.ACCOUNT_NOT_FOUND, data);
};

export const respondUserNotFound = <DataPayload>(
  res: NextApiResponse,
  data: DataPayload
) => {
  respondInfo(res, 404, APP_EVENTS.INFO.USER.USER_NOT_FOUND, data);
};

export const respondValidationFailed = <DataPayload>(
  res: NextApiResponse,
  data: DataPayload
) => {
  respondInfo(res, 400, APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED, data);
};

export const respondBadRequest = <DataPayload>(
  res: NextApiResponse,
  event: EVENT_INFO_TYPE,
  data: DataPayload
) => {
  respondInfo(res, 400, event, data);
};

export const respondForbidden = <DataPayload>(
  res: NextApiResponse,
  data: DataPayload,
  event: EVENT_INFO_TYPE = APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO
) => {
  respondInfo(res, 403, event, data);
};

export const respondUnauthorized = <DataPayload>(
  res: NextApiResponse,
  data: DataPayload,
  event: EVENT_INFO_TYPE = APP_EVENTS.INFO.USER.UNAUTHORIZED
) => {
  respondInfo(res, 401, event, data);
};

export const respondSuccess = <TRes>(
  res: TypedApiResponse<TRes>,
  data: TRes,
  event: EVENT_INFO_TYPE = APP_EVENTS.INFO.APPLICATION.SUCCESS
) => {
  respondInfo(res, 200, event, data);
};

export const respondCreated = <TRes>(
  res: TypedApiResponse<TRes>,
  data: TRes,
  event: EVENT_INFO_TYPE = APP_EVENTS.INFO.APPLICATION.SUCCESS
) => {
  respondInfo(res, 201, event, data);
};

export const respondGeneralError = <DataPayload>(
  res: NextApiResponse,
  data: DataPayload
) => {
  respondInfo(res, 500, APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, data);
};

export const respondNotAcceptable = <DataPayload>(
  res: NextApiResponse,
  event: EVENT_INFO_TYPE,
  data: DataPayload
) => {
  respondInfo(res, 406, event, data);
};

/**
 * 405 Method Not Allowed — the route exists but the HTTP verb is not handled
 * (e.g. a multi-method dispatcher fell through because the request was neither
 * an accepted GET nor POST). Distinct from 400 (malformed request for an
 * ACCEPTED method) and 406 (content-negotiation / pre-auth origin reject) — this
 * is the correct, RFC-aligned status for a method mismatch, so error budgets and
 * monitoring can tell "wrong verb" apart from "bad payload". The middleware's own
 * method-guard (HTTPRequestHandlerMiddleware) already returns 405; this helper is
 * for hand-rolled / multi-method dispatchers that bypass that guard.
 */
export const respondMethodNotAllowed = <DataPayload>(
  res: NextApiResponse,
  event: EVENT_INFO_TYPE,
  data: DataPayload
) => {
  respondInfo(res, 405, event, data);
};

export const respondNotFound = <DataPayload>(
  res: NextApiResponse,
  event: EVENT_INFO_TYPE,
  data: DataPayload
) => {
  respondInfo(res, 404, event, data);
};

export const respondTooManyRequests = <DataPayload>(
  res: NextApiResponse,
  event: EVENT_INFO_TYPE,
  data: DataPayload
) => {
  respondInfo(res, 429, event, data);
};

/**
 * 429 z limitu DOMENOWEGO (nie z limitera per-IP).
 *
 * DECISION: overrides the per-IP limiter's headers because they are not the binding ones here.
 * The per-IP limiter sets `X-RateLimit-*` on EVERY response and describes its own window of some
 * seconds, so a refusal from an hours-long limit came back as "99 attempts left, reset in 11
 * seconds" with no `Retry-After`; a client honouring the standard headers retried every few
 * seconds through the whole window, and every retry costs as much as a rejected request. We
 * report the limit that actually blocks.
 */
export const respondDomainRateLimited = (
  res: NextApiResponse,
  event: EVENT_INFO_TYPE,
  retryAfterSeconds: number
) => {
  res.setHeader('Retry-After', retryAfterSeconds);
  res.setHeader('X-RateLimit-Remaining', 0);
  res.setHeader(
    'X-RateLimit-Reset',
    Math.ceil(Date.now() / 1000) + retryAfterSeconds
  );
  respondInfo(res, 429, event, { retryAfter: retryAfterSeconds });
};

/**
 * 503 AUTH_UNAVAILABLE: the server could not resolve the session, the user or a custom-role
 * permission because its own infrastructure failed (DECISION at AuthUnavailableError in the kernel).
 * `Retry-After` for clients that read standard headers, `data.retryAfter` for the browser app (a
 * cross-origin response does not expose `Retry-After`). Never a token verdict.
 */
export const respondAuthUnavailable = (
  res: NextApiResponse,
  retryAfterSeconds: number
) => {
  res.setHeader('Retry-After', retryAfterSeconds);
  respondInfo(res, 503, APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE, {
    retryAfter: retryAfterSeconds,
  });
};

export const respondConflict = <DataPayload>(
  res: NextApiResponse,
  event: EVENT_INFO_TYPE,
  data: DataPayload
) => {
  respondInfo(res, 409, event, data);
};

/**
 * Request-attributable query failure (`DatabaseError.reason`, set by
 * `classifyQueryFailure`): a unique-constraint race → 409, a dangling foreign key or
 * a value the database refuses to store → 400. Payload-free on purpose (F14: the
 * operation name and cause stay server-side). 409 + VALIDATION_FAILED follows the
 * ADMIN_DUPLICATE_RESOURCE_NAME precedent in the error-mapper.
 */
export const respondQueryFailure = (
  res: NextApiResponse,
  reason: DatabaseFailureReason
) => {
  if (reason === 'UNIQUE_CONFLICT') {
    respondConflict(
      res,
      APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
      undefined
    );
    return;
  }
  respondValidationFailed(res, undefined);
};

export const respondPlanLimitReached = <DataPayload>(
  res: NextApiResponse,
  data: DataPayload
) => {
  respondInfo(
    res,
    403,
    APP_EVENTS.INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO,
    data
  );
};

export const respondStaffAlreadyExists = <DataPayload>(
  res: NextApiResponse,
  data: DataPayload
) => {
  respondInfo(res, 400, APP_EVENTS.INFO.SALON_STAFF.STAFF_ALREADY_EXISTS, data);
};
