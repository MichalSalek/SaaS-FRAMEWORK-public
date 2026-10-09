// hooks/useStylistGalleryPage.ts
// Consolidates data-fetching and derived state for StylistGalleryPageInner.

import { useMemo, useRef, useState } from 'react';
import { useStylistGallery } from '../../shared/gallery/hooks/useStylistGallery';
import { usePairedStylistGallery } from './usePairedStylistGallery';
import { usePairingAccessStatus } from '../../shared/pairing/hooks/usePairingAccessStatus';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { useToggleFavorite } from '../../shared/favorites/hooks/useToggleFavorite';
import {
  useFavoriteRecords,
  flattenFavoriteRecordsPages,
} from '../../shared/favorites/hooks/useFavoriteRecords';
import { useNailLengthOptions } from '../../shared/gallery/nailLengthOptions.config';
import { useFetchRemainingPages } from '../../shared/gallery/hooks/useFetchRemainingPages';
import { createTapSequence } from '../../shared/gallery/tapSequence';

export function useStylistGalleryPage(stylistId: string) {
  /* ── Viewer ── */
  const { data: currentUser } = useCurrentUserAccount();
  const isLoggedInClient =
    currentUser?.client_account !== null &&
    currentUser?.client_account !== undefined;

  /* ── Favoriting ── */
  // DECISION (nie usuwaj tego komentarza): serca startują z PRAWDY SERWERA.
  // Publiczne i sparowane DTO galerii nie niosą `is_favorited`, więc pusty
  // lokalny Set oznaczał, że po odświeżeniu KAŻDE serce było puste, a klik
  // w już-ulubione zdjęcie wysyłał `add` zamiast `remove`. Ulubione klientki
  // (useFavoriteRecords, strony po 20) są dociągane w całości i filtrowane po
  // tej stylistce; lokalne przełączenia żyją jako nadpisania NAD zbiorem
  // serwera (nie zamiast niego), więc refetch po mutacji nie cofa kliknięcia,
  // a onError zdejmuje tylko własne nadpisanie. Query odpalane wyłącznie dla
  // zalogowanej klientki (endpoint client-scoped).
  const favoritesQuery = useFavoriteRecords({ enabled: isLoggedInClient });
  const {
    hasNextPage: hasNextFavoritesPage,
    isFetchingNextPage: isFetchingNextFavoritesPage,
    isFetchNextPageError: isFavoritesPageError,
    fetchNextPage: fetchNextFavoritesPage,
  } = favoritesQuery;
  // Stop przy błędzie strony — inaczej efekt zapętla retry po każdym padzie.
  useFetchRemainingPages(isLoggedInClient, {
    hasNextPage: hasNextFavoritesPage,
    isFetchingNextPage: isFetchingNextFavoritesPage,
    isFetchNextPageError: isFavoritesPageError,
    fetchNextPage: fetchNextFavoritesPage,
  });
  const serverFavoritedIds = useMemo(
    () =>
      new Set(
        flattenFavoriteRecordsPages(favoritesQuery.data)
          .filter(f => f.stylist_account_id === stylistId)
          .map(f => f.gallery_record_id)
      ),
    [favoritesQuery.data, stylistId]
  );
  const [favoriteOverrides, setFavoriteOverrides] = useState<
    ReadonlyMap<string, boolean>
  >(new Map());
  const favoritedIds = useMemo(() => {
    const next = new Set(serverFavoritedIds);
    for (const [id, isFavorited] of favoriteOverrides) {
      if (isFavorited) {
        next.add(id);
      } else {
        next.delete(id);
      }
    }
    return next;
  }, [serverFavoritedIds, favoriteOverrides]);
  const favoritedIdsRef = useRef(favoritedIds);
  favoritedIdsRef.current = favoritedIds;

  // DECISION (nie usuwaj tego komentarza) — 2026-09-24: „nie wiem" to nie
  // „nie polubione". Dopóki ulubione nie są dociągnięte w komplecie (strona
  // w locie albo padnięta), brak rekordu w zbiorze serwera NIE jest dowodem,
  // że serce jest puste: rekord może leżeć na niezaładowanej stronie. Takie
  // serce jest oznaczane jako nierozstrzygnięte (nieaktywne), zamiast
  // udawać potwierdzone „nie", a klik w nie nie wysyła `add` na ślepo.
  // Rozstrzygnięte są: komplet ulubionych, rekord obecny w zbiorze serwera
  // (potwierdzone „tak") i rekord z lokalnym nadpisaniem (decyzja klientki).
  const favoritesComplete =
    !isLoggedInClient ||
    (favoritesQuery.data !== undefined && !hasNextFavoritesPage);
  const favoritesFailed =
    isLoggedInClient &&
    !favoritesComplete &&
    (isFavoritesPageError || favoritesQuery.isError) &&
    !isFetchingNextFavoritesPage &&
    !favoritesQuery.isFetching;
  const isFavoriteResolved = (recordId: string): boolean =>
    favoritesComplete ||
    serverFavoritedIds.has(recordId) ||
    favoriteOverrides.has(recordId);
  const isFavoriteResolvedRef = useRef(isFavoriteResolved);
  isFavoriteResolvedRef.current = isFavoriteResolved;
  const retryFavorites = () => {
    if (favoritesQuery.data === undefined) {
      void favoritesQuery.refetch();
    } else {
      void fetchNextFavoritesPage();
    }
  };
  const isRetryingFavorites =
    favoritesQuery.isFetching || isFetchingNextFavoritesPage;

  const { mutateAsync: toggleFavorite } = useToggleFavorite();
  const [favoriteTaps] = useState(createTapSequence);
  const handleToggleFavorite = (recordId: string) => {
    if (!isFavoriteResolvedRef.current(recordId)) {
      return;
    }
    const isFavorited = favoritedIdsRef.current.has(recordId);
    const seq = favoriteTaps.begin(recordId);
    // mutateAsync + catch, not mutate(vars, { onError }): per-call callbacks
    // of `mutate` fire only for the LATEST call, so a failed toggle followed by
    // a tap on another heart kept its wrong override forever.
    void toggleFavorite({ gallery_record_id: recordId, isFavorited }).catch(
      () => {
        // A newer tap on this heart owns the override now; wiping it here
        // would drop that tap's optimistic state while its request is live.
        if (!favoriteTaps.isLatest(recordId, seq)) {
          return;
        }
        // useToggleFavorite carries meta.suppressGlobalError; the HTTP interceptor
        // (event-bus Stage 1) owns the error toast (backend favorite event or
        // INTERNET_CONNECTION_PROBLEM). This onError only reverts the optimistic
        // override to the pre-toggle value — a local push stacked a second toast
        // (the favoriteError string never dedups against the interceptor's event).
        // Błąd = ZDEJMIJ nadpisanie i wróć do prawdy serwera (onSettled hooka
        // odświeża ulubione). Zapis „poprzedniego" stanu utrwalał niepełny
        // obraz z trakcie seedowania (rekord na 2. stronie → puste serce →
        // duplikujące `add` → błąd → false na stałe).
        setFavoriteOverrides(prev => {
          const next = new Map(prev);
          next.delete(recordId);
          return next;
        });
      }
    );
    setFavoriteOverrides(prev => {
      const next = new Map(prev);
      next.set(recordId, !isFavorited);
      return next;
    });
  };

  /* ── Pairing check ── */
  const {
    isPaired,
    isChecked: pairingChecked,
    checkFailed: pairingCheckFailed,
    isFetching: isRetryingPairingCheck,
    refetch: refetchPairing,
  } = usePairingAccessStatus(stylistId, isLoggedInClient);
  const retryPairingCheck = () => {
    void refetchPairing();
  };

  /* ── Gallery data + filters ── */
  const usePaired = pairingChecked && isPaired;
  const publicGallery = useStylistGallery(stylistId);
  const pairedGallery = usePairedStylistGallery(stylistId, usePaired);
  const gallery = usePaired ? pairedGallery : publicGallery;
  // Eager paired pagination: until every page is in, filters and counts run
  // over a partial set; a failed page is surfaced with its own retry.
  const galleryIncomplete = usePaired && pairedGallery.hasNextPage;
  const galleryPageFailed =
    usePaired &&
    pairedGallery.isFetchNextPageError &&
    pairedGallery.hasNextPage;
  const retryGalleryPage = () => {
    void pairedGallery.fetchNextPage();
  };
  const isRetryingGalleryPage = pairedGallery.isFetchingNextPage;
  const allNailLengths = useNailLengthOptions();

  const {
    allRecords,
    filteredRecords,
    stylistInfo,
    isLoading: galleryLoading,
    isError: galleryIsError,
    hasData: galleryHasData,
    refetch: refetchGallery,
    isFetching: isRetryingGallery,
    filters,
    availableColors,
    availableTraits,
    availableNailLengths: availableNailLengthsRaw,
    totalActiveFilters,
    toggleColor,
    toggleTrait,
    toggleLength,
    setExactMatch,
    clearAll,
    showWatermark,
  } = { ...gallery, showWatermark: publicGallery.showWatermark };
  const availableNailLengths = allNailLengths.filter(o =>
    availableNailLengthsRaw.some(a => a.id === o.id)
  );

  const isLoading = galleryLoading || (isLoggedInClient && !pairingChecked);
  // Full-page error only when there is NOTHING to show. A failed background
  // refetch (or a failed later page) keeps the cached portfolio on screen.
  // An EMPTY cached portfolio under an error is unconfirmed: error with retry,
  // not the "no works yet" empty state.
  const isError =
    galleryIsError && (!galleryHasData || allRecords.length === 0);
  const retryGallery = () => {
    void refetchGallery();
  };

  /* ── Stats ── */
  const { uniqueColors, uniqueStyles } = useMemo(() => {
    const colorIds = new Set<string>();
    const traitIds = new Set<string>();
    for (const r of allRecords) {
      r.colors?.forEach(c => colorIds.add(c.id));
      r.traits?.forEach(tr => traitIds.add(tr.id));
    }
    return { uniqueColors: colorIds.size, uniqueStyles: traitIds.size };
  }, [allRecords]);

  // DECISION (nie usuwaj tego komentarza) — 2026-09-10: teaser „N ukrytych
  // prac" pod siatką ZOSTAŁ USUNIĘTY, bo ta strona nie ma z czego policzyć tej
  // liczby. Liczył `total_count - allRecords.length` z endpointu publicznego,
  // czyli przypięte-i-widoczne minus przypięte-i-widoczne: bramka zapisu nie
  // wpuszcza więcej pinów niż plan, a od 2026-09-10 `total_count` jest ścięty
  // tym samym sufitem planu co lista, więc różnica jest ZAWSZE zerem i teaser
  // (razem z drugim CTA parowania pod siatką) nie renderował się nigdy.
  // Uczciwym źródłem „w pełnej galerii jest więcej" jest `cached_gallery_count`
  // (cała widoczna galeria) minus to, co wyrenderowane — tak liczy to
  // StylistProfileGallery.organism na publicznym profilu. Publiczny endpoint
  // galerii tego licznika nie oddaje, więc odtworzenie teasera TUTAJ wymaga
  // najpierw dołożenia go do PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT w jądrze.
  // Afordancja parowania nie zniknęła: StylistActionPanelOrganism nad siatką
  // renderuje się dla każdej niesparowanej klientki.
  const displayedRecords = filteredRecords;

  return {
    /* gallery state */
    allRecords,
    filteredRecords,
    displayedRecords,
    stylistInfo,
    isLoading,
    isError,
    retryGallery,
    isRetryingGallery,
    galleryIncomplete,
    galleryPageFailed,
    retryGalleryPage,
    isRetryingGalleryPage,
    usePaired,
    pairingCheckFailed,
    retryPairingCheck,
    isRetryingPairingCheck,
    isLoggedInClient,
    /* filters */
    filters,
    availableColors,
    availableTraits,
    availableNailLengths,
    allNailLengths,
    totalActiveFilters,
    toggleColor,
    toggleTrait,
    toggleLength,
    setExactMatch,
    clearAll,
    /* favorites */
    favoritedIds,
    isFavoriteResolved,
    favoritesFailed,
    retryFavorites,
    isRetryingFavorites,
    handleToggleFavorite,
    showWatermark,
    /* stats */
    uniqueColors,
    uniqueStyles,
  };
}
