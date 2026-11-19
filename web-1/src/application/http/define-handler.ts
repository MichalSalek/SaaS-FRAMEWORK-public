import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import type { HTTPMethod } from '@kernel/domain/http/http.config';
import type { UserMetadata } from '@kernel/models/db_models.manual.dto';
import type {
  HandlerPayload,
  ValidationFunction,
} from '@kernel/policies/validation.policy';
import type { EVENT_COMMANDS_AND_QUERIES_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { GetCurrentUserOutput } from '@app/interceptors/domain-interceptors';
import { HTTPRequestHandlerMiddleware } from './request.middleware';
import { withTimingNextHandlerMiddleware } from './timing.middleware';
import { mapErrorToResponse, type DomainError } from './error-mapper';
import type { TypedApiResponse } from './http.responses.utils';

/**
 * Config for {@link defineHandler}. Mirrors `HTTPRequestHandlerMiddleware`'s contract
 * 1:1 — `defineHandler` only collapses the repeated `const handler = ... ;
 * export default withTimingNextHandlerMiddleware(handler)` scaffold plus the inline
 * `HTTPRequestHandlerMiddleware<DTO>(req, res, {...})` call into a single declaration.
 *
 * The `handle` callback keeps the old `businessLogic` body verbatim — it still calls
 * `respondSuccess`/`respondCreated`/`mapErrorToResponse` itself (success shapes are
 * non-uniform — 200 vs 201, per-branch event strings), so `defineHandler` deliberately
 * does NOT auto-map `OperationResult`. The only signature change vs the old inline
 * `businessLogic` is that `res` becomes the 4th parameter instead of a closure capture
 * (the config object can't close over the request's `res`), so migration is mechanical:
 * `businessLogic: async (body, ctx, meta) => {...res...}` → `handle: async (body, ctx, meta, res) => {...res...}`.
 */
export type DefineHandlerConfig<TReq, TRes> = {
  /** CQRS event name from `APP_EVENTS.*` (never a raw string). */
  eventName: EVENT_COMMANDS_AND_QUERIES_TYPE;
  /** HTTP method (Command = 'post', Query = 'get'). */
  method: HTTPMethod;
  /**
   * Request parser. Its success output is the `body` the handler receives (never the request
   * body itself), so its output type must be assignable to `TReq`. A handler without a body
   * declares `NO_VALIDATION` (or the literal no-op form) and receives `{}`.
   */
  validate: ValidationFunction<HandlerPayload<TReq>>;
  /** Auth gate. Defaults to `true` in the middleware; pass `false` for public routes. */
  authCheck?: boolean;
  /**
   * Pre-middleware request mutation, run BEFORE validation. The only legitimate use is
   * promoting GET query params into `req.body` so the body-reading validator sees them
   * (token-confirmation links, OG-meta). The middleware reads payload only from
   * `req.body`; Next.js leaves `req.body` undefined for GET. Keep it to that — it is NOT
   * a place for business logic.
   */
  mapRequest?: (req: NextApiRequest) => void;
  /**
   * Business logic — old `businessLogic` body verbatim. The closure captures `res`
   * (4th arg) and the raw `req` (5th arg) are injected as parameters instead, since the
   * config object cannot close over the request. Handlers that don't touch `req` simply
   * omit it (fewer declared params is assignable).
   */
  handle: (
    body: HandlerPayload<TReq>,
    ctx: GetCurrentUserOutput,
    meta: UserMetadata,
    res: TypedApiResponse<TRes>,
    req: NextApiRequest
  ) => Promise<void>;
};

/**
 * Compose timing middleware and the CQRS request middleware. The pipeline is unchanged,
 * so the HTTP contract stays byte-identical. The second type argument brands `res`
 * with `TRes`; omit it and the response stays unchecked. `handle` receives body, ctx,
 * meta, res and req.
 */
export const defineHandler = <TReq = unknown, TRes = unknown>(
  config: DefineHandlerConfig<TReq, TRes>
): NextApiHandler =>
  withTimingNextHandlerMiddleware(async (req, res) => {
    config.mapRequest?.(req);
    // Null-byte (U+0000) input guard lives in HTTPRequestHandlerMiddleware (step 4b)
    // — the single boundary for ALL CQRS routes (incl. the few that call the
    // middleware directly, bypassing defineHandler). mapRequest above runs first,
    // so promoted GET query params are already in req.body when the guard screens.
    await HTTPRequestHandlerMiddleware<HandlerPayload<TReq>>(req, res, {
      eventName: config.eventName,
      contestedHTTPMethod: config.method,
      businessLogic: (body, ctx, meta) =>
        config.handle(body, ctx, meta, res, req),
      validationFunction: config.validate,
      // exactOptionalPropertyTypes: only set optional keys when actually provided.
      ...(config.authCheck !== undefined && {
        AUTHENTICATION_CHECK_ENABLED: config.authCheck,
      }),
    });
  });

/**
 * Optional early-return guard for SINGLE-branch-success handlers: maps the error and
 * returns `true` when the operation failed (caller does `if (respondOnError(res, r)) return`).
 * After the guard, `result` narrows to its success branch (`result.data` is available).
 * Multi-branch handlers (different success events/statuses) keep their explicit
 * `if (!result.success) return mapErrorToResponse(...)` — do NOT force them through this.
 */
export function respondOnError<T, E extends DomainError>(
  res: NextApiResponse,
  result: OperationResult<T, E>
): result is { success: false; error: E } {
  if (!result.success) {
    mapErrorToResponse(res, result.error);
    return true;
  }
  return false;
}
