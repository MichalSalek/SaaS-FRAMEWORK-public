// UI/shared/hooks/currentUser.query.ts
// SSOT for the "get current user" TanStack Query — consumers like
// `useCurrentUserAccount` (account page, dashboard) read from the same key
// so the request is deduplicated and cache stays consistent.

import { queryOptions } from '@tanstack/react-query';
import { getCurrentUser_IO } from '../../../domain/session/sessionIO.possibilities.api';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { getFromClientStorage } from '../../../application/client-device-storage/clientStorage.possibilities.api';
import { backgroundQueryRetryOptions } from '../../../application/http/background-retry-policy';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';

// The GET /session/get-current IO is declared in the domain layer
// (`domain/session/sessionIO.possibilities.api`, promise-first via `defineEndpoint`). This file
// keeps ONLY the query wiring: the `hasSessionToken()` enabled-gate (reactive per render) and
// the shared `currentUserQueryOptions` so consumers dedupe on one cache key.

// D1-F5: Utility to check session token presence at hook call time.
// Called from useCurrentUserAccount (not inside queryOptions which runs once at
// import time). This makes `enabled` reactive — evaluated per render, re-enables
// the query as soon as the user logs in and the token lands in storage.
export function hasSessionToken(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean(getFromClientStorage({ key: CUSTOM_HEADERS.authorization }));
}

export const currentUserQueryOptions = queryOptions({
  queryKey: queryKeys.account.current,
  // DECISION: TanStack Query v5 rejects a queryFn resolving to `undefined`, and
  // get-current returns 200 without `data` for an orphaned token. The queryFn
  // coalesces to `null` (legal empty) and `select` maps it back to `undefined`,
  // so consumers keep `SafeCurrentUser | undefined`. Dropping `select` would
  // widen `data` to `| null` across the callers.
  queryFn: async ({ signal }) =>
    (await getCurrentUser_IO({}, { signal })) ?? null,
  select: data => data ?? undefined,
  staleTime: 60_000,
  ...backgroundQueryRetryOptions,
});
