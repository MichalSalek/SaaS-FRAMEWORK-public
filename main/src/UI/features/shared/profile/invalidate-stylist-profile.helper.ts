// main/src/UI/features/shared/profile/invalidate-stylist-profile.helper.ts
// Shared cache invalidation for stylist profile mutations.
//
// DECISION: stylist profile changes (location, display name, vanity URL, social links) MUST
// invalidate three caches at once:
//   1. queryKeys.account.current: the stylist's own session view ("My profile")
//   2. queryKeys.public.stylistsListAll: the explore list (other users see fresh data; without it a
//      changed city/name stays stale until cache GC, 5 min default)
//   3. queryKeys.account.profileAll: the PUBLIC stylist profile page (StylistProfilePage), cached
//      per identifier (user id / vanity URL); without it the stylist's own public profile served
//      stale data after an edit for the cache lifetime.
// The identifier is not known here, so #3 invalidates by tuple prefix (profileAll), the same idiom
// as stylistsListAll (any cached filter combination). One helper so future hooks cannot forget the
// public-side cascade.

import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

export const invalidateStylistProfileCaches = (qc: QueryClient): void => {
  void qc.invalidateQueries({ queryKey: queryKeys.account.current });
  void qc.invalidateQueries({ queryKey: queryKeys.account.dashboardFeed });
  void qc.invalidateQueries({ queryKey: queryKeys.public.stylistsListAll });
  void qc.invalidateQueries({ queryKey: queryKeys.account.profileAll });
};
