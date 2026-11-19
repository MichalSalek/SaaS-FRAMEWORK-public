// main/src/application/http/io.ts
// UNIFIED PROMISE-FIRST DATA-LAYER FRONT DOOR: `defineEndpoint` / `defineQuery` /
// `contractPathEndpoint` return `(req, options?) => Promise<Res>` for a TanStack Query `queryFn` /
// `mutationFn`. The SINGLE public surface for declaring transport; it calls the one private
// primitive `callHTTPEndpoint` (interceptor + event-bus + 3-signal abort pipeline).
//
// DECISION: side effects after a response live in the HOOK's TanStack Query callbacks
// (`onSuccess` / `onSettled` / `onMutate`), NEVER in the IO layer, which is pure transport.
//   - cache patch / invalidation / optimistic update + rollback: hook `onSuccess`/`onMutate`/`onError`
//   - success feedback has ONE owner: the interceptor toasts the response event by default; a screen
//     that confirms the outcome itself declares `successFeedback: 'screen'` (guard:
//     success-feedback-owner.test.ts)
//   - error snackbar: a hook may push its own with `meta:{suppressGlobalError:true}`
// EXCEPTIONS (raw `callHTTPEndpoint` + a DECISION at the site): redirect+setCurrentUser ordering,
// `Promise<boolean>` token flows (exchangeAuthCode), raw vendor `fetch`, fail-soft resolve-on-error.

import {
  callHTTPEndpoint,
  type CallHTTPEndpointConfig,
} from './http.possibilities.api';
import { toPromise } from './toPromise.adapter';
import { buildQueryString } from './query-string.utils';
import { apiOrigin, type EndpointURLFunction } from './http.endpoints';
import { fillRouteTemplate, type RouteParams } from '../routing/buildRoute';
import type {
  ApiContract,
  ContractClientRequest,
  ContractResponse,
} from '@kernel/application/contracts/contract.types';
import type { QueryFieldMap } from '@kernel/application/contracts/query-fields';
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
 * DECISION: the mapper must name EVERY field of the request, so a filter added to the request DTO
 * and forgotten here is a compile error. With a loose record, typed filters were shown as chips but
 * silently never sent (the "Logi (3)" badge opened a list of 82). A field deliberately not sent maps
 * to `undefined`.
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
        ...(options?.successFeedback !== undefined
          ? { successFeedback: options.successFeedback }
          : {}),
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
 * Keep the `_IO` suffix on the exported name; it returns a `Promise`, so the hook needs no
 * `toPromise(...)` wrapper.
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

/** Per-endpoint client options of a contract call (transport is fixed by the contract). */
export type ContractEndpointOptions = Pick<
  EndpointConfig,
  'errorFeedbackPolicy' | 'successFeedback'
>;

const clientMode = (method: ApiContract['method']): HTTPMethod => {
  switch (method) {
    case 'GET':
      return 'get';
    case 'POST':
      return 'post';
    case 'PATCH':
      return 'patch';
    case 'DELETE':
      return 'delete';
    default: {
      const unreachable: never = method;
      return unreachable;
    }
  }
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

const queryStringOf = (
  queryFields: QueryFieldMap,
  req: object | null | undefined
): string => {
  const params: Record<
    string,
    string | number | boolean | string[] | undefined
  > = {};
  const values: object = req ?? {};
  for (const key of Object.keys(queryFields)) {
    const value: unknown = Reflect.get(values, key);
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      params[key] = value;
    } else if (isStringArray(value)) {
      params[key] = value;
    }
  }
  return buildQueryString(params);
};

/**
 * A confirmation link is GET. The transport drops a JSON body, and the handler reads `?token`
 * (`beforeParse` copies it onto the body). String fields of the body therefore go on the query.
 */
const confirmationQuery = (req: unknown): string => {
  if (req === null || typeof req !== 'object') {
    return '';
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(req)) {
    if (typeof value === 'string' && value.length > 0) {
      params[key] = value;
    }
  }
  return buildQueryString(params);
};

const contractCall = <C extends ApiContract>(
  contract: C,
  url: EndpointURLFunction,
  options: ContractEndpointOptions
): PromiseIO<ContractClientRequest<C>, ContractResponse<C>> => {
  const mode = clientMode(contract.method);
  if (contract.kind === 'CONFIRMATION') {
    return toPromise<ContractClientRequest<C>, ContractResponse<C>, unknown>(
      makeIO<ContractClientRequest<C>, ContractResponse<C>, unknown>(req => ({
        ...options,
        url: props => `${url(props)}${confirmationQuery(req)}`,
        mode,
      }))
    );
  }
  const queryFields = contract.query;
  return toPromise<ContractClientRequest<C>, ContractResponse<C>, unknown>(
    makeIO<ContractClientRequest<C>, ContractResponse<C>, unknown>(req => {
      if (queryFields === null) {
        return { ...options, url, mode };
      }
      const query = queryStringOf(queryFields, req);
      return {
        ...options,
        url: props => `${url(props)}${query}`,
        mode,
      };
    })
  );
};

/**
 * DECISION: the client call of a kernel API contract. URL, method, request and response types all
 * come from the contract, so a wrong path or a payload of another endpoint cannot be written: there
 * is no URL argument and no generic to get wrong. A GET with query fields serialises the request
 * into the query string (every field the contract declares, nothing else). PATCH and DELETE keep
 * their verb. Same transport as the other factories (abort signal, headers, event pipeline, one
 * success owner).
 */
export function contractEndpoint<C extends ApiContract>(
  contract: C,
  options: ContractEndpointOptions = {}
): PromiseIO<ContractClientRequest<C>, ContractResponse<C>> {
  const base: EndpointURLFunction = props =>
    `${apiOrigin(props)}${contract.route}`;
  return contractCall(contract, base, options);
}

/**
 * Same call as `contractEndpoint` for a route whose path contains `[param]` (salon staff).
 * Encoding matches `buildRoute`: each value is URI-encoded into its bracket.
 */
export function contractPathEndpoint<C extends ApiContract>(
  contract: C,
  options: ContractEndpointOptions = {}
): (
  params: RouteParams<C['route']>
) => PromiseIO<ContractClientRequest<C>, ContractResponse<C>> {
  return params => {
    const path = fillRouteTemplate(contract.route, params);
    const base: EndpointURLFunction = props => `${apiOrigin(props)}${path}`;
    return contractCall(contract, base, options);
  };
}

export { isIOError } from './toPromise.adapter';
