// UI/shared/hooks/useCurrentUserAccount.ts
// TQ v5 query — reusable read of the full CurrentUser (incl. notifications_enabled,
// email_preferences, stylist_account.pricing_plan). Used cross-feature (gallery,
// salon, account, auth, sessions, layout) so it lives in UI/shared/.
// Query options live in `./currentUser.query` so other hooks share the cache.

import { useQuery } from '@tanstack/react-query';
import { currentUserQueryOptions, hasSessionToken } from './currentUser.query';

export function useCurrentUserAccount() {
  // D1-F5: gate — skip the query in SSG / unauthenticated contexts (no token =
  // guaranteed 401, wasted round-trip). hasSessionToken() is evaluated each
  // render so the query re-enables the moment the user logs in.
  return useQuery({ ...currentUserQueryOptions, enabled: hasSessionToken() });
}

/**
 * The current user as far as the cache knows it, WITHOUT asking the backend:
 * a passive observer of the same query. Whoever mounts
 * `useCurrentUserAccount` (the app shell does) fills it.
 *
 * It exists as the second source of „who is this” for the moments when the
 * Better Auth session did not arrive (DECISION in
 * application/auth/session-recovery.ts): `account_type` and `role_id` come
 * from the same `users` row either way.
 */
export function useCachedCurrentUser() {
  return useQuery({ ...currentUserQueryOptions, enabled: false }).data;
}
