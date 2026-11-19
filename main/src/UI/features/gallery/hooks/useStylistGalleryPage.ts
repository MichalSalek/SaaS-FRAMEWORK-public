// hooks/useStylistGalleryPage.ts
// Consolidates data-fetching and derived state for StylistGalleryPageInner.

import { useMemo, useRef, useState } from 'react';
import { useStylistGallery } from '../../shared/gallery/hooks/useStylistGallery';
import { usePairedStylistGallery } from './usePairedStylistGallery';
import { usePairingAccessStatus } from '../../shared/pairing/hooks/usePairingAccessStatus';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import {
  useAuth,
  useCurrentUser,
} from '../../../contexts/AuthContext.composition';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { resolvePairingAudience } from '../../shared/pairing/pairingAudience';
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
  const { user, isLoading: authLoading } = useCurrentUser();
  const { accountType, isLoggedIn } = useAuth();
  const ownProfile = currentUser?.stylist_account?.account_id === stylistId;
  const hasClientAccount = currentUser?.client_account != null;
  const isLoggedInClient =
    user != null && accountType === AccountTypeValue.CLIENT && hasClientAccount;

  /* ── Favoriting ── */
  // DECISION: hearts start from SERVER TRUTH. The public and paired gallery DTOs carry no
  // `is_favorited`, so an empty local Set meant that after a refresh EVERY heart was empty and a
  // click on an already-favourite photo sent `add` instead of `remove`. The client's favourites
  // (useFavoriteRecords, pages of 20) are pulled in full and filtered to this stylist; local
  // toggles live as overrides ON TOP of the server set (not instead of it), so a refetch after a
  // mutation does not undo the click and onError removes only its own override. The query runs only
  // for a logged-in client (the endpoint is client-scoped).
  const favoritesQuery = useFavoriteRecords({ enabled: isLoggedInClient });
  const {
    hasNextPage: hasNextFavoritesPage,
    isFetchingNextPage: isFetchingNextFavoritesPage,
    isFetchNextPageError: isFavoritesPageError,
    fetchNextPage: fetchNextFavoritesPage,
  } = favoritesQuery;
  // Stop on a page error, otherwise the effect loops retries after every failure.
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

  // DECISION: "I don't know" is not "not liked". Until the favourites are pulled in full (a page in
  // flight or failed), a missing record in the server set is NOT proof that the heart is empty: the
  // record may sit on an unloaded page. Such a heart is marked unresolved (inactive) instead of
  // pretending a confirmed "no", and a click does not send `add` blindly. Resolved are: the
  // complete set, a record present in the server set (confirmed "yes") and a record with a local
  // override (the client's decision).
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

    void toggleFavorite({ gallery_record_id: recordId, isFavorited }).catch(
      () => {
        // A newer tap on this heart owns the override now; wiping it here
        // would drop that tap's optimistic state while its request is live.
        if (!favoriteTaps.isLatest(recordId, seq)) {
          return;
        }

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
    isPendingRequest,
    isChecked: pairingChecked,
    checkFailed: pairingCheckFailed,
    isFetching: isRetryingPairingCheck,
    refetch: refetchPairing,
  } = usePairingAccessStatus(stylistId, isLoggedInClient && !ownProfile);
  const audience = resolvePairingAudience({
    authLoading: authLoading || (!user && isLoggedIn),
    hasUser: user != null,
    accountResolved: currentUser !== undefined,
    accountType,
    ownProfile,
    hasClientAccount,
    accessChecked: pairingChecked,
    accessFetching: isRetryingPairingCheck,
    accessFailed: pairingCheckFailed,
    isPaired,
    isPending: isPendingRequest,
  });
  const retryPairingCheck = () => {
    void refetchPairing();
  };

  /* ── Gallery data + filters ── */
  const usePaired = audience === 'clientPaired';
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

  // DECISION: no "N hidden works" teaser under the grid: this page cannot compute that number.
  // `total_count - allRecords.length` from the public endpoint is pinned-and-visible minus
  // pinned-and-visible: the write gate admits no more pins than the plan, and `total_count` is
  // capped by the same plan ceiling as the list, so the difference is ALWAYS zero and the teaser
  // (with the second pairing CTA under the grid) never rendered. The honest source is
  // `cached_gallery_count` (the whole visible gallery) minus what is rendered, as
  // StylistProfileGallery.organism does on the public profile; the public gallery endpoint does not
  // return it, so restoring the teaser HERE first requires adding it to
  // PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT in the kernel. The pairing affordance did not disappear:
  // StylistActionPanelOrganism above the grid renders for every unpaired client.
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
    audience,
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
