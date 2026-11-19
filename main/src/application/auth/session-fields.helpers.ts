// main/src/application/auth/session-fields.helpers.ts
// Typed accessors for Better Auth `additionalFields` on `session.user`.
//
// Better Auth's client `useSession` does NOT auto-infer the `additionalFields` declared in the
// server config (web-1/.../better-auth.config.ts: `role_id`, `account_type`), so the cast and
// narrowing live in these helpers instead of being repeated with Record casts at each call site.

import type { AccountType } from '@kernel/models/db_models.generated.dto';
import { isValidAccountType } from '@kernel/domain/user-and-account/role_switch.config';
import type { authClient } from './better-auth-client';

type AuthClientSession = ReturnType<typeof authClient.useSession>['data'];
type SessionUser = NonNullable<NonNullable<AuthClientSession>['user']>;

/**
 * Read `role_id` (additional field) from the Better Auth session user.
 * Returns null if the field is missing or not a string.
 */
export function getSessionRoleId(
  session: AuthClientSession | undefined
): string | null {
  if (!session?.user) {
    return null;
  }
  const user = session.user as SessionUser & { role_id?: unknown };
  return typeof user.role_id === 'string' ? user.role_id : null;
}

/**
 * Read `account_type` (additional field) from the Better Auth session user.
 * Narrows the raw `unknown` field through `isValidAccountType`; returns the
 * typed AccountType (STYLIST | CLIENT) or null when missing/invalid. Centralizes
 * the cast + narrowing so call sites do not duplicate the guard.
 */
export function getSessionAccountType(
  session: AuthClientSession | undefined
): AccountType | null {
  if (!session?.user) {
    return null;
  }
  const user = session.user as SessionUser & { account_type?: unknown };
  return isValidAccountType(user.account_type) ? user.account_type : null;
}
