import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_COMMANDS_AND_QUERIES_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import type { CurrentUser } from '@kernel/models/user/user.types';

// Always permitted while inactive: read own state + log out (frontend routes the
// user by the state DTO it gets back, then signs them out).
const ALWAYS_ALLOWED_WHILE_INACTIVE: ReadonlySet<EVENT_COMMANDS_AND_QUERIES_TYPE> =
  new Set([
    APP_EVENTS.QUERIES.SESSION.SESSION_GET_CURRENT,
    APP_EVENTS.COMMANDS.USER.USER_LOGOUT,
  ]);

// DECISION: IMPERSONATION_EXIT (SWITCH_BACK_BECOME_USER + REFRESH_IMPERSONATION) must be allowed
// in EVERY inactive state an admin can enter via become-user, not only ADMIN-BAN. `getUser_IO`
// (the target lookup in adminBecomeUser_IO) does not filter by is_active/deleted_at, so an admin
// can impersonate RECOVERABLE and EXPIRED targets too. Otherwise this gate (middleware step 5b,
// before business logic) would 403 USER_DISABLED the switch-back and trap the admin in the
// target's session. Both commands restore the ADMIN's session and are positively bound in
// admin-impersonation.operations.ts (currentUser.id === backup.impersonated_user_id AND
// session.token === backup.impersonated_session_token), so they grant the inactive user nothing.
// Hence one shared constant spread into all three inactive allowlists.
const IMPERSONATION_EXIT: ReadonlyArray<EVENT_COMMANDS_AND_QUERIES_TYPE> = [
  APP_EVENTS.COMMANDS.ADMIN.SWITCH_BACK_BECOME_USER,
  APP_EVENTS.COMMANDS.ADMIN.REFRESH_IMPERSONATION,
];

const RECOVERABLE_ALLOWLIST: ReadonlySet<EVENT_COMMANDS_AND_QUERIES_TYPE> =
  new Set([
    ...ALWAYS_ALLOWED_WHILE_INACTIVE,
    ...IMPERSONATION_EXIT,
    APP_EVENTS.COMMANDS.USER.USER_REACTIVATE_ACCOUNT,
    APP_EVENTS.COMMANDS.USER.USER_GDPR_ERASE,
  ]);

// DECISION: EXPIRED is a legacy fail-safe. Since the recovery move to 90d, MOVE
// (moveExpiredUserToArchive_IO) hard-deletes the row after 90d instead of flipping
// recovery_available to false, so no path produces EXPIRED any more. Keep the allowlist in case
// a flip-instead-of-MOVE regime ever exists; do not remove it.
const EXPIRED_ALLOWLIST: ReadonlySet<EVENT_COMMANDS_AND_QUERIES_TYPE> = new Set(
  [
    ...ALWAYS_ALLOWED_WHILE_INACTIVE,
    ...IMPERSONATION_EXIT,
    APP_EVENTS.COMMANDS.USER.USER_GDPR_ERASE,
  ]
);

const ADMIN_BAN_ALLOWLIST: ReadonlySet<EVENT_COMMANDS_AND_QUERIES_TYPE> =
  new Set([...ALWAYS_ALLOWED_WHILE_INACTIVE, ...IMPERSONATION_EXIT]);

/**
 * Returns true when the resolved (authenticated) account is permitted to invoke
 * `eventName` given its lifecycle state. ACTIVE accounts always pass; inactive
 * accounts pass ONLY events on their state-specific allowlist.
 *
 * Pure + side-effect free — the caller (request.middleware) owns the HTTP response
 * on denial. Call ONLY after a user is resolved (anonymous/public requests have no
 * account state and must not be gated here).
 */
export const isAccountStateActionAllowed = ({
  currentUser,
  eventName,
}: {
  currentUser: CurrentUser;
  eventName: EVENT_COMMANDS_AND_QUERIES_TYPE;
}): boolean => {
  // ACTIVE — full access preserved.
  if (currentUser.is_active) {
    return true;
  }

  // Inactive: classify by deleted_at (self-delete marker) + recovery_available.
  if (currentUser.deleted_at !== null) {
    return currentUser.recovery_available
      ? RECOVERABLE_ALLOWLIST.has(eventName) // RECOVERABLE
      : EXPIRED_ALLOWLIST.has(eventName); // EXPIRED
  }

  // deleted_at === null while inactive ⇒ ADMIN-BAN (no self-delete in play).
  return ADMIN_BAN_ALLOWLIST.has(eventName);
};
