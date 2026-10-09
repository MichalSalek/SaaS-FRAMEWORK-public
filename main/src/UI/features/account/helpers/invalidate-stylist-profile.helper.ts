// main/src/UI/features/account/helpers/invalidate-stylist-profile.helper.ts
// DD3-F6 (2026-05-26): shared cache invalidation for stylist profile mutations.
//
// DECISION (nie usuwaj tego komentarza):
// Stylist profile changes (location, display name, vanity URL, social links) MUST
// invalidate three caches simultaneously:
//   1. queryKeys.account.current — stylist's own session view ("My profile")
//   2. queryKeys.public.stylistsListAll — explore page list (other users see fresh data)
//   3. queryKeys.account.profileAll — the PUBLIC stylist profile page
//      (StylistProfilePage), cached per identifier (user id / vanity URL)
// Without #2, a stylist changes their city/name and the explore page still shows the
// old value until cache GC (5 min default). The bug existed in 4 mutation hooks pre-DD3;
// helper consolidates the pattern so future hooks can't forget the public-side cascade.
// Without #3 (census 2026-07-10), the stylist's own public profile kept serving stale
// data after an edit for the cache lifetime. The identifier is not known here, so we
// invalidate by tuple prefix (profileAll) — TanStack Query matches by tuple prefix,
// same idiom as stylistsListAll (any filter combination currently cached).

import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

export const invalidateStylistProfileCaches = (qc: QueryClient): void => {
  void qc.invalidateQueries({ queryKey: queryKeys.account.current });
  void qc.invalidateQueries({ queryKey: queryKeys.public.stylistsListAll });
  void qc.invalidateQueries({ queryKey: queryKeys.account.profileAll });
};
