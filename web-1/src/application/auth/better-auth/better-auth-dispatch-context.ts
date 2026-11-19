/**
 * Access to the two fields Better Auth SETS AT RUNTIME on `ctx.context` but does NOT declare on
 * the `AuthContext` type.
 *
 * DECISION: `returned` and `responseHeaders` are written by the library's hook runner
 * (`better-auth/dist/api/dispatch.mjs`) right before `hooks.after` runs:
 *
 *     internalContext.context.returned = result.response;
 *     internalContext.context.responseHeaders = result.headers ?? void 0;
 *
 * They are declared only on the library's internal `DispatchContext`, so a bare cast is needed.
 * `audit:better-auth-contract` reads the INSTALLED `dispatch.mjs` and fails when either assignment
 * disappears; otherwise failed-login tracking would die silently (`undefined`). ONE module, not
 * casts at the use sites: a library bump has one place to check.
 */

import type { GenericEndpointContext } from 'better-auth';

/** The shape the hook runner actually adds to `ctx.context`. */
type DispatchRuntimeFields = {
  readonly returned?: unknown;
  readonly responseHeaders?: Headers | undefined;
};

const readDispatchFields = (
  ctx: GenericEndpointContext
): DispatchRuntimeFields => {
  // The only cast of these two fields in the repo; rationale in the DECISION above.
  return (ctx.context ?? {}) as DispatchRuntimeFields;
};

/**
 * Endpoint result as seen by `hooks.after`. On the error path it is an
 * `APIError` instance (better-call wraps `redirect()` as APIError too), on the
 * success path the response body.
 */
export const getDispatchReturned = (ctx: GenericEndpointContext): unknown =>
  readDispatchFields(ctx).returned;

/** Response headers composed by the hook runner (carries `location` on a 302). */
export const getDispatchResponseHeaders = (
  ctx: GenericEndpointContext
): Headers | undefined => readDispatchFields(ctx).responseHeaders;
