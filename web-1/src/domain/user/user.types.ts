import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { Session } from '@kernel/models/db_models.generated.dto';
import type { AuthUnavailableStage } from '@kernel/application/common-errors.types';
import type {
  CurrentUser,
  UserWithRelations,
} from '@kernel/models/user/user.types';

export type GetCurrentUserOutputOptimistic = {
  user: UserWithRelations;
  currentUser: CurrentUser;
  session: Session;
};
export type GetCurrentUserOutput = {
  user: GetCurrentUserOutputOptimistic['user'] | undefined;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'] | undefined;
  session: GetCurrentUserOutputOptimistic['session'] | undefined;
};

export type AnonymousCurrentUserOutput = {
  user: undefined;
  currentUser: undefined;
  session: undefined;
};

/**
 * What the auth chokepoint (`getCurrentUser_IO`) concluded about the caller.
 *
 * DECISION: three outcomes, never two. ANONYMOUS = the credentials did not resolve (no token, an
 * unknown or expired session, a user row that no longer exists): the server's honest 401 verdict.
 * AUTHENTICATED = a confirmed session and its user. UNAVAILABLE = the server could not answer
 * because its OWN infrastructure failed (session table, user row read, effective-plan read).
 * Collapsing UNAVAILABLE into ANONYMOUS answered a database blip with 401 LOGIN_FIRST, which the
 * client treats as "this token is dead" and deletes. UNAVAILABLE never yields a user and never
 * grants access; the middleware maps it to 503 AUTH_UNAVAILABLE.
 */
export type CurrentUserResolution =
  | { status: 'ANONYMOUS'; output: AnonymousCurrentUserOutput }
  | { status: 'AUTHENTICATED'; output: GetCurrentUserOutputOptimistic }
  | { status: 'UNAVAILABLE'; stage: AuthUnavailableStage };

/**
 * Cast-free narrowing from GetCurrentUserOutput (optional fields) to
 * GetCurrentUserOutputOptimistic (required fields).
 *
 * DECISION: instead of a blind cast `ctx as GetCurrentUserOutputOptimistic`, this helper RUNTIME-checks
 * all three fields and rebuilds the exact Optimistic shape; after the guard the fields are narrowed to
 * non-undefined, zero `as`. The thrown `{ event: LOGIN_FIRST }` is caught in request.middleware.ts
 * (hasEvent + IS_INFO_EVENT) => 401. ONLY for auth-ON handlers that require a logged-in user: auth-ON
 * endpoints serving an anonymous user (NOT_LOGGED_IN grants in permissions.seed BASE_PERMISSIONS) must
 * read `ctx.user?.` and MUST NOT use this throwing helper.
 */
export const requireAuthenticatedContext = (
  ctx: GetCurrentUserOutput
): GetCurrentUserOutputOptimistic => {
  const { user, currentUser, session } = ctx;
  if (
    user === undefined ||
    currentUser === undefined ||
    session === undefined
  ) {
    throw { event: APP_EVENTS.INFO.USER.LOGIN_FIRST };
  }
  return { user, currentUser, session };
};
