import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { Session } from '@kernel/models/db_models.generated.dto';
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

/**
 * Cast-free narrowing from GetCurrentUserOutput (optional fields) to
 * GetCurrentUserOutputOptimistic (required fields).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Zamiast blind-castu `ctx as GetCurrentUserOutputOptimistic` ten helper
 * RUNTIME-sprawdza obecność wszystkich trzech pól i rekonstruuje dokładny
 * kształt Optimistic. Po guardzie pola są zawężone do non-undefined — zero
 * `as`. Rzut `{ event: LOGIN_FIRST }` jest łapany przez catch w
 * request.middleware.ts (hasEvent + IS_INFO_EVENT) → 401.
 * UWAGA: WYŁĄCZNIE dla handlerów auth-ON wymagających zalogowanego usera.
 * Endpointy auth-ON serwujące anonima (granty NOT_LOGGED_IN w
 * permissions.seed BASE_PERMISSIONS) MUSZĄ czytać `ctx.user?.` itd. i NIE
 * wolno im używać tego throwującego helpera.
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
