import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import type {
  ApiContract,
  ContractAuditEvent,
  ContractHandlerResponse,
  ContractPayload,
  ContractResponse,
  ContractSuccessEvent,
} from '@kernel/application/contracts/contract.types';
import { decodeQueryFields } from '@kernel/application/contracts/query-fields';
import { findContractResponseViolation } from '@kernel/application/contracts/contract-response';
import { contractBodyValidator } from '@kernel/policies/validation/contract.validation';
import {
  NO_VALIDATION,
  type ValidationFunction,
} from '@kernel/policies/validation.policy';
import type { UserMetadata } from '@kernel/models/db_models.manual.dto';
import type { HTTPMethod } from '@kernel/domain/http/http.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_COMMANDS_AND_QUERIES_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import type { GetCurrentUserOutput } from '@app/interceptors/domain-interceptors';
import {
  recordAuditEvent_IO,
  type AuditEventInput,
} from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { ENV_VARS } from '@app/environment/environment.config';
import { HTTPRequestHandlerMiddleware } from './request.middleware';
import { withTimingNextHandlerMiddleware } from './timing.middleware';
import {
  respondCreated,
  respondMethodNotAllowed,
  respondSuccess,
  type TypedApiResponse,
} from './http.responses.utils';

/** Everything a contract handler works with; the types come from the contract, never from generics. */
export type EndpointScope<C extends ApiContract> = {
  /** The parsed body, the decoded query, or `{}` (NoPayload): never the raw request. */
  input: ContractPayload<C>;
  ctx: GetCurrentUserOutput;
  meta: UserMetadata;
  req: NextApiRequest;
  /** For `mapErrorToResponse` and the error responders. */
  res: TypedApiResponse<ContractResponse<C>>;
  /** 200 with one of the contract's success events. Date or ISO string; the wire is the string. */
  ok: (
    data: ContractHandlerResponse<C>,
    event: ContractSuccessEvent<C>
  ) => void;
  /** 201 with one of the contract's success events. Date or ISO string; the wire is the string. */
  created: (
    data: ContractHandlerResponse<C>,
    event: ContractSuccessEvent<C>
  ) => void;
  /**
   * Records one of the contract's audit events after the response (fire-and-forget scheduled
   * BEFORE the response is sent, so it survives a serverless freeze). Redact the body first.
   */
  audit: (
    event: ContractAuditEvent<C>,
    entry: Pick<AuditEventInput, 'user' | 'requestBody' | 'responseBody'>
  ) => void;
};

export type DefineEndpointConfig<C extends ApiContract> = {
  handle: (scope: EndpointScope<C>) => Promise<void>;
  /**
   * Server-only tweak before the parser. Preserves a legacy `mapRequest` (a confirmation link
   * copies its token from the query, or from the body when the query omitted it). Not part of
   * the contract object, so it never ships as client data.
   */
  beforeParse?: (req: NextApiRequest) => void;
};

const toMiddlewareMethod = (method: ApiContract['method']): HTTPMethod => {
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

/**
 * The request parser for one request: the contract's body schema, its query fields (read from
 * `req.query`, the body is ignored), or nothing. A query schema, when the contract declares one,
 * turns a bad decoded query into the same 400 the old validator returned.
 */
const requestParser = <C extends ApiContract>(
  contract: C,
  req: NextApiRequest
): ValidationFunction<ContractPayload<C>> => {
  if (contract.body !== null) {
    // The validator's output is z.output of exactly this schema, i.e. ContractPayload<C>.
    return contractBodyValidator(contract.body) as ValidationFunction<
      ContractPayload<C>
    >;
  }
  const query = contract.query;
  if (query !== null) {
    const querySchema =
      contract.kind === 'QUERY' ? (contract.querySchema ?? null) : null;
    return () => {
      // decodeQueryFields returns QueryServerOutput of exactly this field map, which is what
      // ContractPayload<C> resolves to for a query contract; TS cannot follow the generic C.
      const decoded: unknown = decodeQueryFields(query, req.query);
      if (querySchema !== null) {
        return contractBodyValidator(querySchema)(decoded) as ReturnType<
          ValidationFunction<ContractPayload<C>>
        >;
      }
      return {
        __isValid: true,
        __general: '',
        __data: decoded as ContractPayload<C>,
      };
    };
  }
  // NoPayload: what ContractPayload<C> is for a contract without body and query.
  return NO_VALIDATION as ValidationFunction<ContractPayload<C>>;
};

/**
 * DECISION: in tests and development every 2xx response is checked against the contract (declared
 * success event, `data` in wire form parses with the response schema). A violation THROWS: the
 * request middleware turns it into a reported 500, so a handler that drifted from its contract fails
 * its own test instead of shipping a payload the client type does not describe. Production,
 * preview and staging skip the check (no cost, no behaviour change on live traffic).
 */
const CHECK_RESPONSES = !['PRODUCTION', 'PREVIEW', 'STAGING'].includes(
  ENV_VARS.NODE_ENV_MANUAL
);

const guardResponses = (contract: ApiContract, res: NextApiResponse): void => {
  const send = res.json.bind(res);
  res.json = body => {
    const violation = findContractResponseViolation(
      contract,
      res.statusCode,
      body
    );
    if (violation !== null) {
      throw new Error(`Contract violation: ${violation}`);
    }
    return send(body);
  };
};

/**
 * Binds a Next API route to its kernel contract: method gate, auth, RBAC on the contract key, the
 * request parser, the limiter tier (by route) and the typed responders all come from `contract`.
 * Same middleware pipeline as `defineHandler`, so the HTTP envelope is unchanged.
 *
 * @example
 *   export default defineEndpoint(FAVORITE_CONTRACTS.FAVORITE_ADD_RECORD, {
 *     handle: async ({ input, ctx, res, created, audit }) => { ... },
 *   });
 */
const runContract = <C extends ApiContract>(
  contract: C,
  config: DefineEndpointConfig<C>,
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> => {
  config.beforeParse?.(req);
  const typedRes: TypedApiResponse<ContractResponse<C>> = res;
  if (CHECK_RESPONSES) {
    guardResponses(contract, res);
  }
  return HTTPRequestHandlerMiddleware<ContractPayload<C>>(req, res, {
    // The contract key IS the operation key (pure equality): the generated APP_EVENTS entry.
    // `system:contracts --check` (audit) proves every contract key exists in APP_EVENTS.
    eventName: contract.key as EVENT_COMMANDS_AND_QUERIES_TYPE,
    contestedHTTPMethod: toMiddlewareMethod(contract.method),
    validationFunction: requestParser(contract, req),
    AUTHENTICATION_CHECK_ENABLED: contract.authCheck,
    businessLogic: (input, ctx, meta) =>
      config.handle({
        input,
        ctx,
        meta,
        req,
        res: typedRes,
        ok: (data, event) =>
          respondSuccess(typedRes, data as ContractResponse<C>, event),
        created: (data, event) =>
          respondCreated(typedRes, data as ContractResponse<C>, event),
        audit: (event, entry) =>
          runAfterResponse(() =>
            recordAuditEvent_IO({
              ...entry,
              eventName: event,
              metadata: meta,
            })
          ),
      }),
  });
};

/**
 * Binds a Next API route to its kernel contract: method gate, auth, RBAC on the contract key, the
 * request parser, the limiter tier (by route) and the typed responders all come from `contract`.
 * Same middleware pipeline as `defineHandler`, so the HTTP envelope is unchanged.
 *
 * @example
 *   export default defineEndpoint(FAVORITE_CONTRACTS.FAVORITE_ADD_RECORD, {
 *     handle: async ({ input, ctx, res, created, audit }) => { ... },
 *   });
 */
export const defineEndpoint = <C extends ApiContract>(
  contract: C,
  config: DefineEndpointConfig<C>
): NextApiHandler =>
  withTimingNextHandlerMiddleware(async (req, res) => {
    await runContract(contract, config, req, res);
  });

/**
 * One operation inside a file that already serves two verbs (salon staff GET + POST on one path).
 * The handle is checked against its own contract here; the switch stores the widened binding.
 */
export type EndpointBinding = {
  contract: ApiContract;
  handle: (scope: EndpointScope<ApiContract>) => Promise<void>;
  beforeParse?: (req: NextApiRequest) => void;
};

export const bindEndpoint = <C extends ApiContract>(
  contract: C,
  handle: (scope: EndpointScope<C>) => Promise<void>,
  beforeParse?: (req: NextApiRequest) => void
): EndpointBinding => {
  const binding: EndpointBinding = {
    contract,
    handle: handle as EndpointBinding['handle'],
  };
  if (beforeParse !== undefined) {
    binding.beforeParse = beforeParse;
  }
  return binding;
};

/**
 * Dispatches one file to several contracts by HTTP method. OPTIONS is answered by the first
 * contract's middleware (CORS 200, same as every `defineEndpoint`). Any other unmatched verb is
 * 405 with the salon-staff fallthrough envelope (no `Allow` header; that header belongs to the
 * single-method middleware gate).
 */
export const defineEndpointSwitch = (
  bindings: readonly EndpointBinding[]
): NextApiHandler => {
  const first = bindings[0];
  if (first === undefined) {
    throw new Error('defineEndpointSwitch requires at least one contract');
  }
  return withTimingNextHandlerMiddleware(async (req, res) => {
    if (req.method === 'OPTIONS') {
      await runContract(first.contract, { handle: first.handle }, req, res);
      return;
    }
    const method = req.method?.toUpperCase();
    const match = bindings.find(binding => binding.contract.method === method);
    if (match === undefined) {
      respondMethodNotAllowed(
        res,
        APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
        undefined
      );
      return;
    }
    const config: DefineEndpointConfig<ApiContract> = { handle: match.handle };
    if (match.beforeParse !== undefined) {
      config.beforeParse = match.beforeParse;
    }
    await runContract(match.contract, config, req, res);
  });
};
