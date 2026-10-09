// main/src/application/http/io.ts
//
// UNIFIED PROMISE-FIRST DATA-LAYER FRONT-DOOR (FDX FAZA 2, decyzja D3).
//
// One way to declare a backend call. `defineEndpoint` / `defineQuery` /
// `definePathEndpoint` each return a `(req, options?) => Promise<Res>` function
// ready to drop into a TanStack Query `queryFn` / `mutationFn` — NO `toPromise`
// wrapper at the call site, NO "which factory?" decision.
//
// This is the SINGLE public surface for declaring transport. It calls the
// private low-level `callHTTPEndpoint` directly (the interceptor + event-bus +
// 3-signal abort pipeline). There is exactly one low-level primitive
// (`callHTTPEndpoint`), never a second public style.
//
// DECISION (nie usuwaj tego komentarza) — WZORZEC MIGRACJI (FAZA 2):
//   Side-effects after a response live in the HOOK's TanStack Query callbacks
//   (`onSuccess` / `onSettled` / `onMutate`), NEVER inside the IO layer.
//   - cache patch / invalidation  → hook `onSuccess`/`onSettled`
//   - optimistic update + rollback → hook `onMutate`/`onError`
//   - snackbar/event-bus           → interceptor already pushes it; a hook may
//                                     add a specific one via `pushNewSnackbar`
//                                     (with `meta:{suppressGlobalError:true}`)
//   An IO function defined here is PURE transport: request in → `Promise<Res>` out.
//
//   EXCEPTIONS (keep raw `callHTTPEndpoint` + a DECISION-comment, do NOT force
//   into this front-door): load-bearing redirect+setCurrentUser ordering
//   (becomeUser/switchBackUser), `Promise<boolean>` token flows
//   (exchangeAuthCode), raw vendor `fetch` (cloudinary upload), fail-soft
//   resolve-on-error (maintenance message). These are documented at their sites.

import {
  callHTTPEndpoint,
  type CallHTTPEndpointConfig,
} from './http.possibilities.api';
import { toPromise } from './toPromise.adapter';
import { buildQueryString } from './query-string.utils';
import type { EndpointURLFunction } from './http.endpoints';
import type { HTTPMethod } from '@kernel/domain/http/http.config';
import { resolveErrorFeedbackPolicy } from './error-feedback.policy';
import type {
  IOClientCallOptions,
  IOClientFunctionReqResErr,
} from '@kernel/application/http/http.client.types';

/** Promise-first IO function: request in → typed `Promise<Res>` out. */
export type PromiseIO<Req, Res> = (
  req: Req,
  options?: IOClientCallOptions
) => Promise<Res>;

/** Static endpoint config (no per-request URL mutation). */
export type EndpointConfig = Omit<
  CallHTTPEndpointConfig,
  'payload' | 'externalSignal'
>;

/** Query-string field map: request fields → URL params. */
type QueryFields = Record<
  string,
  string | number | boolean | string[] | undefined
>;

/**
 * DECISION (nie usuwaj tego komentarza): the mapper must name EVERY field of
 * the request, so a filter added to the request DTO and forgotten here is a
 * compile error. Until S126 the return type was a loose record: three admin
 * requests (`attention` on log groups and users, `awaiting_reply` and
 * `category` on support threads) typed the new filter, the screen showed its
 * chip, and the URL silently went out without it, so „Logi (3)” opened a list
 * of 82. A field that is deliberately not sent maps to `undefined`.
 */
type ExhaustiveQueryFields<Req> = {
  [K in keyof NonNullable<Req>]-?: QueryFields[string];
};

export type QueryConfig<Req> = Omit<EndpointConfig, 'mode'> & {
  queryFields: (req: Req) => ExhaustiveQueryFields<Req>;
};

/**
 * Build a callback-based IO function around `callHTTPEndpoint`, deriving the
 * per-call config from the request (lets `defineQuery` append a query string).
 * Private — the public surface is the promise-first `defineX` wrappers below.
 */
function makeIO<Req, Res, Err>(
  buildConfig: (req: Req) => EndpointConfig
): IOClientFunctionReqResErr<Req, Res, Err> {
  return (req, successCallback, errorCallback, options) => {
    const config = buildConfig(req);
    return callHTTPEndpoint<Res, Err>({
      config: {
        ...config,
        payload: req,
        errorFeedbackPolicy: resolveErrorFeedbackPolicy(
          config.mode,
          config.errorFeedbackPolicy,
          options?.signal !== undefined
        ),
        ...(options?.signal ? { externalSignal: options.signal } : {}),
        ...(options?.silentBusinessError ? { silentBusinessError: true } : {}),
      },
      successCallback,
      errorCallback,
    });
  };
}

/**
 * Declare a backend endpoint (POST/PATCH/DELETE/GET without query string).
 * Returns a promise-first function — use directly in `mutationFn`/`queryFn`.
 *
 * Keep the existing `_IO` suffix on the exported name (FAZA 2 does NOT rename —
 * 146 call-sites; the win is promise-first, not a rename). It just returns a
 * `Promise` now, so the hook drops the `toPromise(...)` wrapper.
 *
 * ```ts
 * export const changeName_IO = defineEndpoint<ChangeNameReq, User>({
 *   url: props => `${apiBase(props)}${ROUTES_API.ACCOUNT_CHANGE_NAME}`,
 *   mode: 'post',
 * });
 * // hook: mutationFn: changeName_IO   // was: toPromise(changeName_IO)
 * ```
 */
export function defineEndpoint<Req, Res, Err = unknown>(
  config: EndpointConfig
): PromiseIO<Req, Res> {
  return toPromise<Req, Res, Err>(makeIO<Req, Res, Err>(() => config));
}

/**
 * Declare a GET endpoint that carries a query string built from the request.
 * `queryFields(req)` maps the request to URL params (cursor/filter/pagination).
 */
export function defineQuery<Req, Res, Err = unknown>(
  config: QueryConfig<Req>
): PromiseIO<Req, Res> {
  return toPromise<Req, Res, Err>(
    makeIO<Req, Res, Err>(req => ({
      url: props =>
        `${config.url(props)}${buildQueryString(config.queryFields(req))}`,
      mode: 'get' as HTTPMethod,
      ...(config.errorFeedbackPolicy !== undefined
        ? { errorFeedbackPolicy: config.errorFeedbackPolicy }
        : {}),
    }))
  );
}

/**
 * Declare an endpoint whose URL contains a path parameter (e.g. `/staff/[id]`).
 * Curried: pass the concrete path param to get a promise-first IO function.
 *
 * ```ts
 * export const removeStaff_IO = definePathEndpoint<void, RemoveRes>(
 *   staffId => props => `${apiBase(props)}${buildRoute(ROUTES_API.STAFF_REMOVE, { staffId })}`,
 *   'delete',
 * );
 * // hook: mutationFn: (staffId) => removeStaff_IO(staffId)(undefined)
 * ```
 */
export function definePathEndpoint<Req, Res, Err = unknown>(
  buildUrl: (pathParam: string) => EndpointURLFunction,
  mode: HTTPMethod
): (pathParam: string) => PromiseIO<Req, Res> {
  return (pathParam: string) =>
    toPromise<Req, Res, Err>(
      makeIO<Req, Res, Err>(() => ({ url: buildUrl(pathParam), mode }))
    );
}

export { isIOError } from './toPromise.adapter';
