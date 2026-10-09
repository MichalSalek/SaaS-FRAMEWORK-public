# Adding a new feature

This document describes how a feature travels through the codebase: from the contract in the
shared kernel, through the backend slice, to the frontend feature, and which gates it has to pass
on the way. It is the working procedure of the project, not an idealised one. It was last checked
against the code on 2026-10-09 by walking the `favorites` slice step by step.

Implementation plans here are executed by coding agents as well as by the owner. That is the
reason most rules below are enforced mechanically (types, audit scripts, git hooks) instead of
being left to review: a slice that skips a step fails a typecheck or an audit.

## The path at a glance

```
.shared-kernel/   contract: event, route, HTTP method, DTO, validator, role permissions
      |           npm run system:kernel   (copy into both apps)
      v
web-1/            backend: handler (defineHandler) -> domain operation (_IO) -> Prisma
      v
main/             frontend: IO function -> TanStack Query hook -> component -> page shell
```

The order is deliberate. Both applications compile against a read-only copy of the kernel, so a
contract that exists first turns every missing piece downstream into a compile error or an audit
failure. The backend comes before the frontend because the frontend derives its endpoint map and
its request and response types from the same kernel keys; nothing is declared twice.

One key carries the whole feature. The CQRS event name (for example `FAVORITE_ADD_RECORD`) is the
key in `APP_EVENTS`, in `ROUTES_API`, in `API_HTTP_METHODS`, in the DTO type and in the role
permission sets. The audits check that these registries agree by plain key equality.

## Ground rules

- Changes start in `.shared-kernel/`, the single source of truth for contracts.
- Build and typecheck are static verification only. Rules and the handler to HTTP contract get
  behaviour tests in Vitest; the doctrine is in `tests/BACKEND_TESTING.md`.
- Backend imports use the aliases `@kernel/*`, `@app/*` and `@domain/*`, never deep relative paths.

## Decisions before writing code

Three questions fix the shape of the slice. Does it change state (command and POST, or query and
GET)? Who may call it (public: `authCheck: false` in the handler and the event in
`BASE_PERMISSIONS`; private: authentication is on by default and the event goes into a role set)?
Does it need a new page (then a front route and its role mapping belong to the contract too)?

## Step 1: the kernel contract

### 1.1 Event

File: `.shared-kernel/domain/events/app-events.const.ts`. Add the event name to
`APP_EVENTS.COMMANDS.<DOMAIN>` or `APP_EVENTS.QUERIES.<DOMAIN>`, and the informational events the
handler will emit to `APP_EVENTS.INFO.<DOMAIN>`. Only INFO events that are really emitted: the
events audit sweeps the repository and fails on one that is defined and never referenced.

`.shared-kernel/domain/commands-and-queries/cqrs.config.ts` lists the event groups by hand. A new
event inside an existing group needs no change there. A new group has to be listed under
`COMMANDS`, `QUERIES` and `INFO` (an empty array where it has no events of that kind), otherwise
the event type unions do not see it and the typecheck fails.

### 1.2 Route and 1.3 HTTP method

- `.shared-kernel/domain/routing/routing.config.ts`: an entry in `ROUTES_API`, key = event name.
- `.shared-kernel/domain/http/http-methods.config.ts`: an entry in `API_HTTP_METHODS`, `'GET'` or
  `'POST'`.

### 1.4 DTO

Directory: `.shared-kernel/models/`, one file per domain, for example
`.shared-kernel/models/favorites/favorite.dto.ts`. The type is named `<DOMAIN>_DTO_API_V1` and each
operation, keyed by the event name, has four members: `REQUEST`, `RESPONSE`, `RESPONSE_ERROR` and
`IO_CLIENT_FUNCTION`.

### 1.5 Validator (commands)

Directory: `.shared-kernel/policies/validation/`, one file per domain. A validator is a zod schema
plus an adapter. The schema goes into the domain file, the entry into that file's validators
object, and a compile-time witness binds the schema to the request DTO; if the two drift apart,
the witness type stops compiling:

```typescript
const favoriteRemoveRecordSchema = z.object({
  gallery_record_id: z
    .string({ error: V.favorite.invalidRecordId })
    .min(1, V.favorite.invalidRecordId),
});

export const favoriteValidators = {
  favoriteRemoveRecord: (data: unknown) =>
    zodValidate(favoriteRemoveRecordSchema, data),
} as const;

export type FavoriteRequestSchemaBindings = {
  favoriteRemoveRecord: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof favoriteRemoveRecordSchema>,
      FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['REQUEST']
    >
  >;
};
```

- Error messages are i18n keys from `.shared-kernel/domain/i18n/validation.i18n.ts`, never
  literals. A new key needs a translation in `main/src/locales/pl/common.json` and its `en` and
  `de` siblings.
- `.shared-kernel/policies/validation.policy.ts` assembles `VALIDATION_POLICY.validators` by
  spreading the per-domain objects. A new validator in an existing file needs no change there; a
  new domain file has to be imported and spread by hand.
- Queries read no body, so they declare an explicit no-op: `validate: () => ({ __isValid: true })`.
  A handler with no `validate` key at all is rejected, and a no-op on a write method is rejected
  unless it is on a justified allowlist.

### 1.6 Default role permissions

File: `.shared-kernel/application/role-permissions.ts`. Add the event to `BASE_PERMISSIONS` (not
logged in), `LOGGED_USER_PERMISSIONS` (any logged-in role), `STYLIST_SPECIFIC_PERMISSIONS` or
`CLIENT_SPECIFIC_PERMISSIONS`. An event in none of them is reachable only by the master admin role.
That is legitimate for admin endpoints, and the permissions audit keeps a baseline count of such
events, so a new one is a conscious change in `tests/audit/permissions.sh` and not an accident.

### 1.7 Audit event registration and event translations

- An INFO event passed to `recordAuditEvent_IO` has to be listed in `allowedEventLogTypes` in
  `.shared-kernel/domain/event-log/event_log.config.ts`. Without the entry the policy gate returns
  false and the audit write is a silent no-op.
- Its description goes into `.shared-kernel/domain/event-log/event-log-descriptions.config.ts`.
- Every INFO event that reaches the response envelope (passed to a `respond*` helper or mapped in
  the error mapper) needs a key in `main/src/locales/pl/events.json` and its `en` and `de`
  siblings; otherwise the UI shows the raw token.

## Step 2: propagate and gate

`npm run system:kernel` copies `.shared-kernel/` into `main/src/READONLY-shared-kernel/` and
`web-1/src/READONLY-shared-kernel/`. After a Prisma schema change, `npm run system:kernel:full`
regenerates the model DTOs first. The copies are read-only; `scripts/hooks/readonly-guard` blocks
commits that edit them directly.

A contract change also regenerates the API map: `cd main && npm run dev:gen-openapi`, which
rewrites `main/src/application/api-docs/openapi.generated.json` from the DTOs, routes and methods.

Then `npm run audit:all` and `npm run typecheck`. Before the handler exists, the routes audit
reports the new route as not implemented. That is expected and disappears after step 3.

## Step 3: the backend slice

### 3.1 Handler

Path: `web-1/src/pages/api/v1/<domain>/<feature>/index.ts`. A CQRS endpoint is one call to
`defineHandler` from `web-1/src/application/http/define-handler.ts`, which composes the timing
middleware and the request middleware (method check, authentication, permission check, validation,
catch-all). A real command, `web-1/src/pages/api/v1/favorite/add-record/index.ts`, with the
imports left out:

```typescript
export default defineHandler<
  FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['REQUEST'],
  FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.FAVORITE.FAVORITE_ADD_RECORD,
  method: 'post',
  validate: VALIDATION_POLICY.validators.favoriteAddRecord,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await addRecordToFavorites_IO({
      gallery_record_id: body.gallery_record_id,
      id: currentUser.id,
      note: body.note !== undefined ? body.note : null,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload: FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['RESPONSE'] =
      {
        id: result.data.id,
        client_user_id: result.data.client_user_id,
        gallery_record_id: result.data.gallery_record_id,
        note: result.data.note ?? null,
      };

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORD_ADDED,
        user: currentUser,
        requestBody: redactAuditPayload(body, ['gallery_record_id']),
        metadata,
      })
    );

    respondCreated(
      res,
      responsePayload,
      APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORD_ADDED
    );
  },
});
```

The user id comes from the session (`currentUser.id`), never from the request body.

Configuration fields: `eventName` (always from `APP_EVENTS`), `method`, `validate`, optional
`authCheck` (default true), optional `mapRequest` (runs before validation; its only legitimate use
is promoting GET query parameters into the body for token links), and `handle`, which receives
`(body, ctx, metadata, res, req)` and writes the response itself. The second type parameter binds
the response: `res` carries the declared `RESPONSE` type, and `respondSuccess` and `respondCreated`
then require their payload to match it at compile time.

A query differs in three places:

```typescript
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const cursor = qStr(req.query, 'cursor') ?? undefined;
    const take = qInt(req.query, 'take') ?? 50;
    // ...
    respondSuccess(res, result.data);
  },
```

The helpers in `web-1/src/application/http/query-params.utils.ts` (`qStr`, `qNum`, `qInt`,
`qBool`, `qStrArray`) return `null` when a parameter is absent and take no default argument.
Pagination parameters go through `qInt`, because a fractional `take` reaches Prisma as a float.

Rules for a handler file:

- No database client. All data access is in domain operations.
- No `try/catch`, no timing wrapper, no error reporting; the middleware owns those. Domain errors
  are returned through `mapErrorToResponse`.
- Account guards (`requireStylistAccount`, `requireClientAccount` from
  `web-1/src/domain/_shared/guards/account-guards.ts`) are the only inline check.
- A POST that creates a resource answers 201 through `respondCreated`; everything else answers 200
  through `respondSuccess`. The event argument is optional and has to be an `APP_EVENTS.INFO`
  constant.

Endpoints outside the CQRS middleware (webhooks, service-to-service calls, health checks) use
`withPublicHandler` or `withRawSecretHandler` from
`web-1/src/application/http/define-raw-handler.ts` instead.

### 3.2 Domain operation

Path: `web-1/src/domain/<domain>/operations/`, kebab-case file names. The file suffix table is in
`web-1/src/domain/README.md`.

```typescript
export const myOperation_IO = async (params: {
  id: string;
}): Promise<OperationResult<ResponseType, MyDomainError | DatabaseError>> => {
  try {
    const data = await DB_CLIENT.use.model.findUnique({ where: { id: params.id } });
    if (!data) return failure({ type: 'MY_NOT_FOUND', id: params.id });
    return success(toResponse(data));
  } catch (error) {
    return databaseFailure('myOperation_IO', error);
  }
};
```

- Prisma is used directly through `DB_CLIENT.use.<model>`. There is no repository layer; that is
  a recorded decision, and an audit fails if an infrastructure layer appears.
- An operation returns `OperationResult<T, E>` (`.shared-kernel/application/result.types.ts`) and
  does not throw domain errors.
- Every function that performs I/O carries the `_IO` suffix. Transactions run inside the operation.
- `databaseFailure` from `web-1/src/application/errors/error-result.helpers.ts` is the only idiom
  for a failed database call: it logs the stack server-side and returns an opaque error.

### 3.3 Domain error type

Path: `.shared-kernel/domain/<domain>/`, for example
`.shared-kernel/domain/favorites/favorite-errors.types.ts`. A new error variant joins the domain's
union type, and `web-1/src/application/http/error-mapper.ts` maps it to a status and an event.
The mapper is one exhaustive switch over the union of all domain errors, so a variant without a
case is a compile error. A new domain adds its whole union to that type, never single members.

## Security review of a new endpoint

- Ownership. The user id comes from `currentUser.id`. An endpoint that acts on another user needs
  an explicit admin guard and an ownership check. The question to answer: can user A read or
  change user B's data by swapping an id in the request?
- Method alignment. Commands are POST with a real validator. Queries are GET with query
  parameters; a GET with a body is not used, proxies strip it.
- Delivery. The audit log write is fire-and-forget through `runAfterResponse`
  (`web-1/src/application/runtime/run-after-response.ts`), and its request body goes through
  `redactAuditPayload` with an allowlist of keys, so email addresses, phone numbers and notes
  never enter the log. Losing an audit entry is acceptable; losing a critical email or a payment
  step is not, so those are awaited and return an `OperationResult`.

## Race-safe patterns

These apply to quota-sensitive operations, webhooks that mutate state, and any side effect that
has to be conditional on committed state.

**Lock first, verify after create.** Two concurrent requests can both pass a `count < limit`
pre-check, and a recount alone does not close the race under Read Committed. The pattern, all
inside one transaction: take a pessimistic row lock on a shared ancestor row as
the first statement, through a primitive in `web-1/src/application/db/lock-rows.ts` (raw
`FOR UPDATE` elsewhere is rejected by an audit, because lock order is a global invariant); run the
pre-check and the write; recount as a backstop against a future non-locking writer; on overflow
throw a dedicated sentinel class, caught by `instanceof` outside the transaction and translated
into a domain error.

Reference implementations: `web-1/src/domain/gallery/operations/gallery-create.operation.ts` and
`web-1/src/domain/salon-staff/operations/salon-staff-management.operations.ts`. For a delete with
an ownership check, a single `deleteMany` with both the id and the owner in the filter replaces
find-then-delete.

**Post-commit effects.** A side effect scheduled inside a transaction fires even when the
transaction rolls back. Handlers that run inside a transaction return a list of effects instead;
the caller schedules them with `runAfterResponse` only after the commit. See
`web-1/src/application/stripe/webhooks/stripe-effects.types.ts` and
`web-1/src/pages/api/v1/webhooks/stripe/index.ts`.

## Step 4: permissions at runtime

The permission list is built from the command and query events. On backend start,
`web-1/src/application/permissions/permissions.seed.ts` reconciles the system roles in the
database with the kernel sets, so the two cannot diverge. The request middleware calls
`checkPermission` from `web-1/src/application/permissions/permissions.cache.ts`: system roles are
answered from immutable in-memory sets, custom roles by a direct database query without a cache.
The master admin role holds every event except the self-only ones listed in
`web-1/src/application/permissions/permissions.config.ts`. A system role therefore gets access
only through the kernel sets; custom roles are managed in the admin panel and apply immediately.

## Step 5: the frontend data layer

There is one way to declare a backend call: `defineEndpoint`, `defineQuery` or
`definePathEndpoint` from `main/src/application/http/io.ts`. The functions live in the domain
layer, `main/src/domain/<domain>/`, for example
`main/src/domain/favorites/favoriteIO.possibilities.api.ts`:

```typescript
export const addRecordToFavorites_IO = defineEndpoint<
  FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['REQUEST'],
  FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['RESPONSE'],
  FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.FAVORITE_ADD_RECORD,
  mode: 'post',
});
```

`defineQuery` takes the same three type parameters and builds the query string from the request
through a `queryFields` function; `definePathEndpoint` covers routes with a path parameter.

- `ENDPOINTS` in `main/src/application/http/http.endpoints.ts` is derived from `ROUTES_API`. A key
  added in the kernel appears there by itself. The only manual entry is an alias for an operation
  that shares another operation's route.
- Query keys are defined once in `main/src/application/http/queryKeys.factory.ts`, with the domain
  prefix from `main/src/application/http/queryDomains.config.ts` as the first element.
- Hooks live in `main/src/UI/features/<domain>/hooks/` and pass the IO function straight to
  `queryFn` or `mutationFn`. Side effects such as cache invalidation belong to the hook, not to the
  IO function. The view layer never imports `ENDPOINTS`.

A new page adds a route to `ROUTES_FRONT_APP` or `ROUTES_FRONT_STATIC` in the routing config and a
role mapping in `.shared-kernel/domain/permissions/permissions.config.ts`. This is the frontend's
route access map and is separate from API permissions. Route protection under `/app` is
client-side, through the guarded layout shells; the backend remains the security boundary.

## Step 6: UI

Conventions: `main/src/UI/UI_ARCHITECTURE.md` and `main/src/UI/components/ATOMIC_LAYERS.md`.

- Every component file under `main/src/UI/` carries its atomic layer in the file name and in the
  export name: `FavoritesPage.composition.tsx` exports `FavoritesPageComposition`. The layers are
  atom, molecule, organism and composition. Barrel files are avoided; imports point at the
  file that defines the symbol.
- A feature page is a composition in `main/src/UI/features/<domain>/`. Past the file length limit
  set in ESLint it is split into a `.parts.organism.tsx` file.
- The file under `main/src/pages/` is a thin shell: it renders the composition and loads the
  translation namespaces in `getStaticProps`. The feature component renders the layout.
- A new shared component under `main/src/UI/components/` is registered in
  `main/src/UI/features/ui-library/uiLibrary.registry.ts`.
- Styling is CSS Modules with tokens from `main/src/UI/styles/tokens.css` and
  `main/src/UI/styles/themes/palettes.css`. No hard-coded colours.
- Page texts go into `main/src/locales/pl/common.json` and its `en` and `de` siblings; the three
  locales have to hold identical key sets.

## Gates

A pre-commit hook (`scripts/hooks/pre-commit`) runs the audits that match the staged paths
(kernel, backend, frontend) plus the typecheck. The pre-push hook (`scripts/hooks/pre-push`) and
`npm run git:push` run the full suite in `tests/audit/run-all.sh`, the TypeScript compiler, ESLint
and both Vitest suites. The audit catalogue is `tests/audit/README.md`.

| Rule | Enforced by |
| --- | --- |
| Event, route and method registries agree | `tests/audit/ssot-routes.sh`, `tests/audit/ssot-events.sh`, `tests/audit/endpoint-completeness.sh` |
| DTO key equals route key equals method key | `tests/audit/dto-completeness.sh`, `tests/audit/registry-orphan.sh` |
| Every event has a role or is counted as admin-only | `tests/audit/permissions.sh` |
| Handler declares a validator; no-op only on reads | `tests/audit/validation-coverage.sh`, `tests/audit/noop-validation-allowlist.sh` |
| Canonical handler shape, method matches the registry | `tests/audit/handler-shape.sh`, `tests/audit/handler-method-consistency.sh` |
| Identity from the session, not from the body | `tests/audit/security-idor.sh`, `tests/audit/currentuser-enforcement.sh`, `tests/audit/no-body-cast.sh` |
| Audit events are registered | `tests/audit/event-log-registration.sh` |
| Envelope events are constants and translated | `tests/audit/response-event-validation.sh`, `tests/audit/events-i18n-coverage.sh`, `tests/audit/events-i18n-parity.sh` |
| API map matches the DTOs | `tests/audit/openapi-fresh.sh` |
| Kernel copies are in sync | `tests/audit/kernel-sync.sh` |
| Prisma only through the shared client | `tests/audit/prisma-access.sh` |
| Import aliases, `_IO` suffix, kebab-case files | `tests/audit/import-aliases.sh`, `tests/audit/operation-io-suffix.sh`, `tests/audit/naming-case.sh` |
| One database error idiom, row locks only through primitives | `tests/audit/database-failure.sh`, `tests/audit/lock-discipline.sh` |
| Frontend IO front door | `tests/audit/io-layer.sh` |
| Atomic layer suffix, component catalogue | `tests/audit/atomic-coverage.sh`, `tests/audit/ui-library-coverage.sh` |
| Schema matches request DTO, error has a mapper case, operation returns a result | TypeScript |

One rule in this document has no script behind it: keeping the database client out of handler
files is held by review.

## Definition of done

- The kernel was propagated; `npm run audit:all` and `npm run typecheck` pass.
- The slice is consistent end to end: event, route, method, DTO, role set, handler, IO function.
- Access works as intended: without permission the endpoint answers with the login or
  unauthorized event, with permission it succeeds.
- The security review above was done for every new endpoint.
- A new business rule or security gate has a behaviour test, run with
  `cd web-1 && npm run test:unit`. Frontend test tiers: `tests/FRONTEND_TESTING.md`.
