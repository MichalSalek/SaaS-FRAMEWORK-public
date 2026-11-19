import type { z } from 'zod';
import { API_VER } from '../../domain/http/http.config';
import type { EVENT_INFO_TYPE } from '../../domain/commands-and-queries/cqrs.types';
import type { APP_EVENTS } from '../../domain/events/app-events.const';
import type { ParsedData } from '../../policies/validation/validation.zod';
import type { NoPayload } from '../../policies/validation/validation.types';
import type { DetailedErrorPayload } from '../http/http.types';
import type { IOClientFunctionReqResErr } from '../http/http.client.types';
import type {
  QueryClientInput,
  QueryFieldMap,
  QueryHasRequiredField,
  QueryServerOutput,
} from './query-fields';

/**
 * ONE CONTRACT PER ENDPOINT.
 *
 * DECISION: an operation is declared once, here in the kernel, and everything else is derived from
 * it: the route, the HTTP method, the request parser and its type, the response type and its runtime
 * check, the success and audit events, the default role grants and the limiter tier. The backend
 * binds a handler with `defineEndpoint(contract, ...)` (web-1), the client calls
 * `contractEndpoint(contract)` (main); neither repeats a URL, a method or a DTO generic. The
 * legacy registries (ROUTES_API, API_HTTP_METHODS, APP_EVENTS command/query keys, role grants,
 * `<DOMAIN>_DTO_API_V1`) are GENERATED from the contracts by `npm run system:contracts` and stay as
 * the compatibility layer for code and audits that read them; never edit a generated region.
 *
 * A contract holds data and pure schemas only, because it ships in the client bundle: no secret,
 * no server import, no handler.
 */

/**
 * Default API grants, mapped onto the role-permission layers of `role-permissions.ts`:
 * PUBLIC = BASE (anonymous included), LOGGED_IN = every authenticated role, STYLIST / CLIENT =
 * that role (plus MASTER_ADMIN), STYLIST_AND_CLIENT = both role layers, ADMIN = MASTER_ADMIN only
 * (the wildcard grant). PUBLIC_NO_GRANT emits no layer line: `authCheck: false` already skips the
 * permission check, and the route was left out of BASE_PERMISSIONS on purpose (pricing plans, the
 * contact form). A PUBLIC grant there would widen the table.
 */
export type ContractAccess =
  | 'PUBLIC'
  | 'PUBLIC_NO_GRANT'
  | 'LOGGED_IN'
  | 'STYLIST'
  | 'CLIENT'
  | 'STYLIST_AND_CLIENT'
  | 'ADMIN';

/** Per-IP limiter tier (`RATE_LIMIT_CONFIG` in web-1): strict = the sensitive-endpoint window. */
export type LimiterTier = 'default' | 'strict';

/** APP_EVENTS group the generated command/query key lands in. */
export type ContractEventGroup = keyof typeof APP_EVENTS.COMMANDS &
  keyof typeof APP_EVENTS.QUERIES;

type BodySchema = z.ZodObject<z.ZodRawShape>;

type ContractCommon = {
  /** One sentence for the API documentation (Polish, like the rest of /dev/api). */
  readonly summary: string;
  readonly group: ContractEventGroup;
  /** Path below API_VER, e.g. `favorite/add-record`; must match the file route under pages/api/v1. */
  readonly path: string;
  /** Shape of `data` in a successful envelope, checked in tests and development. */
  readonly response: z.ZodType;
  /** Events a 2xx response may carry. */
  readonly successEvents: readonly EVENT_INFO_TYPE[];
  /** Events the handler may record in the event log through `audit`. */
  readonly auditEvents: readonly EVENT_INFO_TYPE[];
  readonly access: ContractAccess;
  /** `false` only for routes reachable without a session (the middleware auth gate). */
  readonly authCheck: boolean;
  readonly limiterTier: LimiterTier;
};

/**
 * A write. The method is POST, plus the two salon-staff routes that already speak PATCH and DELETE.
 * A request-body parser's output is the handler payload. No query string.
 */
export type CommandContractSpec = ContractCommon & {
  readonly kind: 'COMMAND';
  readonly method: 'POST' | 'PATCH' | 'DELETE';
  readonly body: BodySchema;
  readonly query: null;
};

/**
 * A read: GET without a body; `query` = its query-string fields, `null` = none.
 * `querySchema`, when set, re-checks the decoded query and 400s with that schema's error DTO.
 * Leave it unset when a bad value is dropped or replaced by a fallback (the lenient codecs).
 */
export type QueryContractSpec = ContractCommon & {
  readonly kind: 'QUERY';
  readonly method: 'GET';
  readonly body: null;
  readonly query: QueryFieldMap | null;
  readonly querySchema?: BodySchema | null;
};

/**
 * A GET confirmation link (account deletion, email change). The operation key lives in
 * `APP_EVENTS.CONFIRMATIONS`, not in a command/query group. The body schema runs after
 * `beforeParse` copies `?token` onto the body, so a missing token is still the body error DTO.
 */
export type ConfirmationContractSpec = Omit<ContractCommon, 'group'> & {
  readonly kind: 'CONFIRMATION';
  readonly method: 'GET';
  readonly body: BodySchema;
  readonly query: null;
};

/**
 * DECISION: a union on `kind`, so a GET with a body or a command with query fields does not compile
 * (CQRS: a command is a write, a query is a GET). CONFIRMATION is the emailed-link exception: GET
 * plus a token body, because that is the live wire. Writes stay POST except salon staff PATCH and
 * DELETE; rewriting those verbs would change the client. The generator repeats the check
 * (`findIllegalContracts`) because it runs through tsx without type checking.
 */
export type ContractSpec =
  CommandContractSpec | QueryContractSpec | ConfirmationContractSpec;

/** A contract after `defineContracts`: the spec plus its operation key and full route. */
export type ApiContract = ContractSpec & {
  readonly key: string;
  readonly route: string;
};

type Keyed<T extends Record<string, ContractSpec>> = {
  readonly [K in keyof T & string]: T[K] & {
    readonly key: K;
    readonly route: `${typeof API_VER}${T[K]['path']}`;
  };
};

export const defineContracts = <const T extends Record<string, ContractSpec>>(
  specs: T
): Keyed<T> => {
  const out: Record<string, ApiContract> = {};
  for (const [key, spec] of Object.entries(specs)) {
    out[key] = Object.freeze({ ...spec, key, route: `${API_VER}${spec.path}` });
  }
  // The loop adds exactly `key` and `route` to every spec, which is what Keyed<T> states.
  return Object.freeze(out) as Keyed<T>;
};

// ── Derived types ──────────────────────────────────────────────────────────────────────────────

type BodyOf<C extends ContractSpec> = C['body'];
type QueryOf<C extends ContractSpec> = C['query'];

/** What the handler receives: the parsed body, the decoded query, or nothing. */
export type ContractPayload<C extends ContractSpec> =
  BodyOf<C> extends BodySchema
    ? ParsedData<z.output<BodyOf<C>>>
    : QueryOf<C> extends QueryFieldMap
      ? QueryServerOutput<QueryOf<C>>
      : NoPayload;

/**
 * DECISION: a query REQUEST is the object, never `T | undefined`. A required key
 * (`QUERY_FIELD.requiredString`) is mandatory on that object. Unioning `undefined` onto the whole
 * argument made `CLIENT_GET_CRM_NOTE` callable without `client_user_id` and made every `req.field`
 * access possibly undefined. The client call of an all-optional query still accepts `undefined`
 * (`ContractClientRequest`); a required query does not.
 */
export type ContractRequest<C extends ContractSpec> =
  BodyOf<C> extends BodySchema
    ? ParsedData<z.output<BodyOf<C>>>
    : QueryOf<C> extends QueryFieldMap
      ? QueryClientInput<QueryOf<C>>
      : undefined;

/** What the client sends: the body INPUT, the query input, or nothing. */
export type ContractClientRequest<C extends ContractSpec> =
  BodyOf<C> extends BodySchema
    ? ParsedData<z.input<BodyOf<C>>>
    : QueryOf<C> extends QueryFieldMap
      ? QueryHasRequiredField<QueryOf<C>> extends true
        ? QueryClientInput<QueryOf<C>>
        : QueryClientInput<QueryOf<C>> | undefined
      : undefined;

export type ContractResponse<C extends ContractSpec> = ParsedData<
  z.output<C['response']>
>;

/**
 * DECISION: `ok` accepts the handler's value (a Prisma `Date` or the ISO string) while
 * `ContractResponse` stays the JSON string the client reads. `defineEndpoint` is that boundary.
 * Test: the response check in `contract-response.ts` parses the JSON round trip.
 */
export type ContractHandlerResponse<C extends ContractSpec> = ParsedData<
  z.input<C['response']>
>;

export type ContractResponseError<C extends ContractSpec> =
  DetailedErrorPayload<ContractRequest<C>>;

export type ContractSuccessEvent<C extends ContractSpec> =
  C['successEvents'][number];

export type ContractAuditEvent<C extends ContractSpec> =
  C['auditEvents'][number];

export type ContractIOClientFunction<C extends ContractSpec> =
  IOClientFunctionReqResErr<
    ContractRequest<C>,
    ContractResponse<C>,
    ContractResponseError<C>
  >;
