// UI/features/gallery/hooks/useSessionPickFavorites.ts
// „Tylko polubione” while a client picks a photo for a session
// (?addToSession=…): her favourites at THIS stylist, complete, plus the toggle.

import { useMemo, useState } from 'react';
import {
  useFavoriteRecords,
  flattenFavoriteRecordsPages,
} from '../../shared/favorites/hooks/useFavoriteRecords';
import { useFetchRemainingPages } from '../../shared/gallery/hooks/useFetchRemainingPages';

export function useSessionPickFavorites(
  stylistId: string,
  isSessionPickMode: boolean
) {
  /* Likes → session bridge. While building a session, a client can narrow the
   * gallery to photos she ALREADY liked from this stylist (less digging). The
   * source is her favourite records (server truth), filtered by the session's
   * stylist; backend ownership only lets this stylist's photos through anyway.
   * The query runs ONLY in pick mode (enabled), so ordinary viewers do not fire
   * a client-scoped request. */
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const {
    data: favData,
    fetchNextPage: fetchNextFavPage,
    hasNextPage: hasNextFavPage,
    isFetchingNextPage: isFetchingNextFavPage,
    isFetchNextPageError: isFavPageError,
  } = useFavoriteRecords({ enabled: isSessionPickMode });
  // useFavoriteRecords is an infinite query (pages of 20). The „tylko ulubione"
  // filter needs ALL of this stylist's favourites, otherwise a client with >20
  // likes overall gets an understated counter and an incomplete filter. The set
  // is bounded, so in pick mode we fetch all pages (once).
  // Stop on a failed page: without the guard the effect retried the failed page
  // in a loop, because `hasNextPage` stays true (see the DECISION in
  // useFetchRemainingPages).
  useFetchRemainingPages(isSessionPickMode, {
    hasNextPage: hasNextFavPage,
    isFetchingNextPage: isFetchingNextFavPage,
    isFetchNextPageError: isFavPageError,
    fetchNextPage: fetchNextFavPage,
  });
  const favoritedRecordIdsForStylist = useMemo(() => {
    if (!isSessionPickMode) {
      return new Set<string>();
    }
    return new Set(
      flattenFavoriteRecordsPages(favData)
        .filter(f => f.stylist_account_id === stylistId)
        .map(f => f.gallery_record_id)
    );
  }, [favData, stylistId, isSessionPickMode]);
  const stylistFavoritesCount = favoritedRecordIdsForStylist.size;
  // The filter is active ONLY while this stylist has favourites: if they drop to 0
  // (e.g. the client unlikes the last one) the filter switches itself off and shows
  // the full gallery, instead of leaving a dead empty screen behind a hidden-but-on toggle.
  const effectiveFavoritesOnly = favoritesOnly && stylistFavoritesCount > 0;

  return {
    favoritesOnly,
    toggleFavoritesOnly: () => setFavoritesOnly(v => !v),
    effectiveFavoritesOnly,
    favoritedRecordIdsForStylist,
    stylistFavoritesCount,
  };
}
