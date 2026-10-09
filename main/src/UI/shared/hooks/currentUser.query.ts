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

// FDX FAZA 2 (W2.3): the GET /session/get-current IO is now declared in the
// domain layer (`domain/session/sessionIO.possibilities.api`, promise-first via
// `defineEndpoint`) instead of being created locally here in UI. This file keeps
// ONLY the query wiring: the `hasSessionToken()` enabled-gate (D1-F5, reactive
// per-render) and the shared `currentUserQueryOptions` so consumers dedupe on
// one cache key.

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
  // DECISION (nie usuwaj tego komentarza):
  // TanStack Query v5 ZABRANIA queryFn resolved === undefined (loguje w dev
  // "Query data cannot be undefined" + wrzuca query w error-state). Endpoint
  // GET /session/get-current zwraca 200 {event:SUCCESS} BEZ pola `data`, gdy
  // backend nie zresolwował currentUser (token osierocony/wygasły — np. po
  // reseedzie DB, a `hasSessionToken()`-gate jest true bo token wciąż siedzi w
  // localStorage). getCurrentUser_IO() === undefined w tym wypadku.
  // Dwustopniowo: queryFn koalescuje undefined → null (TQ-legalna pustka, więc
  // cache trzyma null zamiast undefined), a `select` mapuje null → undefined z
  // powrotem — konsumenci `useCurrentUserAccount().data` zachowują kontrakt
  // `SafeCurrentUser | undefined` 1:1 (zero kaskady typów). NIE upraszczać do
  // samego queryFn bez select (rozjedzie typ `data` na `| null` w ~6 callsite'ach).
  queryFn: async ({ signal }) =>
    (await getCurrentUser_IO({}, { signal })) ?? null,
  select: data => data ?? undefined,
  staleTime: 60_000,
  ...backgroundQueryRetryOptions,
});
