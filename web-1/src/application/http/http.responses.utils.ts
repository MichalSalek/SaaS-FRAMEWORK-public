import type { NextApiResponse } from 'next';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { HTTPStatus } from '@kernel/domain/http/http.config';
import type { DatabaseFailureReason } from '@kernel/application/common-errors.types';
import { getInfoEventWithPayloadDTO, asStatusCode } from './http.utils.api';
import { assertResponseShape } from './response-assert';

/**
 * A `NextApiResponse` branded with the handler's declared RESPONSE DTO (FWE Wave I).
 *
 * DECISION (nie usuwaj tego komentarza):
 * When a handler is declared via `defineHandler<TReq, TRes>`, its `res` carries this
 * phantom brand, and `respondSuccess`/`respondCreated` then REQUIRE their `data` to match
 * `TRes` at compile time — the success-shape contract is enforced by the type system, not
 * merely documented by a local `const payload: ...RESPONSE = ...` annotation. The brand is
 * a contravariant phantom function (never set at runtime) so `TRes` is inferred from `res`,
 * not from `data`. An UNBRANDED `NextApiResponse` infers `TRes = unknown`, so legacy
 * call-sites (and the error responders below, which carry an error payload, not the success
 * DTO) stay fully back-compatible — only handlers that opt in via the second type param get
 * the stricter check.
 */
export type TypedApiResponse<TRes> = NextApiResponse & {
  readonly __responseBrand?: (value: TRes) => void;
};

/**
 * DECISION (nie usuwaj tego komentarza):
 * DD3-F8 (2026-05-26): Default Cache-Control: no-store on all API responses.
 * Rationale: API returns JSON envelope `{ event, data }` with user-specific or
 * security-sensitive content (auth state, permissions, account details). Without
 * an explicit header, intermediaries (CDN, reverse proxy, browser back-forward
 * cache) might cache responses → stale auth, info leak, broken optimistic UI.
 * Public-cacheable endpoints (sitemap, llms.txt, public-stylists-list snapshots)
 * MUST opt-in by setting their own Cache-Control BEFORE calling respond*(), or by
 * setting the header after, since we only set when missing (skip if already set).
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
 * DECISION (nie usuwaj tego komentarza): nadpisuje nagłówki limitera per-IP,
 * bo w takiej odpowiedzi to nie one są wiążące. Limiter per-IP ustawia
 * `X-RateLimit-*` na KAŻDEJ odpowiedzi i opisuje swoje kilkunastosekundowe
 * okno, więc odmowa z limitu liczonego w godzinach wracała z „masz jeszcze
 * 99 prób, reset za 11 sekund" i bez `Retry-After`. Klient honorujący
 * standardowe nagłówki ponawiał co kilkanaście sekund przez całe okno, a każde
 * ponowienie kosztuje tyle, co odrzucone żądanie — czyli obciążenie rosło
 * dokładnie wtedy, gdy user był już ponad limitem (zaobserwowane na własnym
 * harnessie testowym, który się na tym zawiesił). Mówimy prawdę o limicie,
 * który faktycznie blokuje.
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
