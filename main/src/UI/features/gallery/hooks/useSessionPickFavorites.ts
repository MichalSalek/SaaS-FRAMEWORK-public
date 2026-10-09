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
  /* Most lajki → sesja (2026-07-12)
   * Budując sesję, klientka może zawęzić galerię do zdjęć, które JUŻ polubiła
   * u tej stylistki (mniej przekopywania). Źródło = jej ulubione rekordy
   * (server-truth), filtrowane po stylistce sesji; ownership backendu i tak
   * przepuszcza tylko zdjęcia tej stylistki. Query odpalane WYŁĄCZNIE w pick-
   * mode (enabled), żeby nie firować client-scoped requestu dla zwykłych widzów. */
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const {
    data: favData,
    fetchNextPage: fetchNextFavPage,
    hasNextPage: hasNextFavPage,
    isFetchingNextPage: isFetchingNextFavPage,
    isFetchNextPageError: isFavPageError,
  } = useFavoriteRecords({ enabled: isSessionPickMode });
  // useFavoriteRecords to infinite-query (strony po 20). Do filtra „tylko
  // ulubione" potrzebujemy KOMPLETU ulubionych tej stylistki — inaczej klientka
  // z >20 lajkami globalnie dostaje zaniżony licznik i niepełny filtr. Zbiór jest
  // ograniczony, więc w pick-mode dociągamy wszystkie strony (jednorazowo).
  // Stop przy błędzie strony: bez guardu efekt ponawiał padniętą stronę
  // w pętli, bo `hasNextPage` zostaje true (DECISION w hooku).
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
  // Filtr aktywny TYLKO gdy realnie są ulubione tej stylistki — jeśli spadną do 0
  // (np. klientka odlajkuje ostatnie), filtr sam się wyłącza i pokazuje pełną
  // galerię, zamiast zostawić głuchą pustkę z ukrytym-ale-włączonym togglem.
  const effectiveFavoritesOnly = favoritesOnly && stylistFavoritesCount > 0;

  return {
    favoritesOnly,
    toggleFavoritesOnly: () => setFavoritesOnly(v => !v),
    effectiveFavoritesOnly,
    favoritedRecordIdsForStylist,
    stylistFavoritesCount,
  };
}
