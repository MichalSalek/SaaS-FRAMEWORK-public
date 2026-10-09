import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useViewTransitionRouter } from '../../layouts/useViewTransitionRouter';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { useState } from 'react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { GalleryFilterBarOrganism } from './components/GalleryFilterBar.organism';
import { GalleryFloatingFiltersOrganism } from './components/GalleryFloatingFilters.organism';
import { InfiniteScrollTriggerComposition } from '../../components/InfiniteScrollTrigger.composition';
import { useGalleryFilterOptions } from '../shared/gallery/hooks/useGalleryFilterOptions';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useGalleryLayout } from '../../shared/hooks/useGalleryLayout';
import {
  useOwnGallery,
  flattenGalleryPages,
} from '../shared/gallery/hooks/useOwnGallery';
import { useDashboardFeed } from '../shared/dashboard/hooks/useDashboardFeed';
import { useOwnGalleryFilters } from './hooks/useOwnGalleryFilters';
import { useGalleryFiltersUrl } from './hooks/useGalleryFiltersUrl';
import { useGalleryReturnPosition } from './hooks/useGalleryReturnPosition';
import { useFetchRemainingPages } from '../shared/gallery/hooks/useFetchRemainingPages';
import { useNailLengthOptions } from '../shared/gallery/nailLengthOptions.config';
import {
  PlanLimitBannerOrganism,
  GalleryHeroMolecule,
  GallerySkeletonGridMolecule,
  GalleryEmptyStateOrganism,
  OwnGalleryCardItem,
} from './GalleryPage.parts.organism';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import styles from './GalleryPage.module.css';

function GalleryPageInner() {
  const t = useTranslations('pages.gallery');
  useAppBarTitle(t('myTitle'));

  const navigate = useViewTransitionRouter();
  const {
    data: galleryData,
    isLoading,
    isError,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isRefetching,
    fetchNextPage,
    refetch,
  } = useOwnGallery();
  const { data: currentUser } = useCurrentUserAccount();
  const {
    colors: allColors,
    traits: allTraits,
    optionsLoadFailed,
    retryOptions,
    isRetryingOptions,
  } = useGalleryFilterOptions();

  const allNailLengths = useNailLengthOptions();
  const galleryRecords = flattenGalleryPages(galleryData);
  const filterState = useOwnGalleryFilters(galleryRecords);
  const {
    filteredRecords,
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
  } = filterState;
  // Filters live in the address and the list position is remembered, so a
  // return from a photo lands on the same filtered list at the same place.
  const filtersReady = useGalleryFiltersUrl(filterState);
  const isPending = isLoading || !filtersReady;
  useGalleryReturnPosition('own-gallery', !isPending);
  const [filterBarInView, setFilterBarInView] = useState(true);
  const availableNailLengths = allNailLengths.filter(o =>
    availableNailLengthsRaw.some(a => a.id === o.id)
  );

  const { layout, isFullWidth, toggleLayout } = useGalleryLayout('own-gallery');

  const handleGoToUpload = () => {
    navigate(ROUTES_FRONT.GALLERY_UPLOAD_ASSET);
  };

  const handleCardClick = (recordId: string) => {
    navigate(buildRoute(ROUTES_FRONT.PHOTO_DETAIL, { id: recordId }));
  };

  const isEmpty = galleryRecords.length === 0;
  // Totals come from the dashboard feed (cached_gallery_count + pinned count),
  // the same numbers the dashboard and the public profile show. The loaded
  // page is 12 rows and must never be presented as the gallery size.
  const { feed } = useDashboardFeed();
  const worksCount = feed?.photo_count;
  const pinnedCount = feed?.pinned_count;

  // Filters run client-side over loaded pages. When the active filter matches
  // nothing loaded yet but more pages exist, keep loading instead of declaring
  // „brak wyników" — the empty branch never rendered the scroll trigger, so a
  // photo that only lives on page 2 was unreachable through filters. A failed
  // page stops the search (shown inline with a retry, filters kept).
  const searchingMorePages =
    totalActiveFilters > 0 && filteredRecords.length === 0 && !isEmpty;
  useFetchRemainingPages(searchingMorePages, {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  });
  const currentPlan =
    currentUser?.stylist_account?.pricing_plan ?? PricingPlanValue.FREE;
  const planConfig = PRICING_POLICY.utils.getPlanConfig(currentPlan);
  const maxPhotos = planConfig.max_gallery_records;

  // Show the error state only when the initial load failed with no data yet.
  // A transient error during a route-transition / background refetch (network
  // blip, 401) must NOT flash the error screen over the skeleton or over photos
  // that already loaded — TQ retries and recovers. Mirrors ExplorePage gate.
  // An EMPTY cached gallery under an error is unconfirmed (no photos to keep
  // on screen), so it gets the error with retry, not "add your first photo".
  const showError =
    isError && !isLoading && (galleryData === undefined || isEmpty);
  const hasPhotos = !isPending && !isEmpty && !showError;
  // One set of filter props for both entries (the row and the floating button).
  const filterSheetProps = {
    allColors,
    allTraits,
    allNailLengths,
    availableColors,
    availableTraits,
    availableNailLengths,
    selectedColors: filters.selectedColors,
    selectedTraits: filters.selectedTraits,
    selectedLength: filters.selectedLength,
    exactMatch: filters.exactMatch,
    matchingCount: filteredRecords.length,
    // Facets and counts come from the LOADED pages only: while more exist, an
    // option missing from them is „not loaded", not „absent".
    resultsIncomplete: hasNextPage,
    optionsLoadFailed,
    onRetryOptions: retryOptions,
    isRetryingOptions,
    totalActiveFilters,
    onToggleColor: toggleColor,
    onToggleTrait: toggleTrait,
    onToggleLength: toggleLength,
    onExactMatchChange: setExactMatch,
    onClearAll: clearAll,
  };

  return (
    <div className={styles.page}>
      {/* Tor treści = kontener zapytań rozmiarowych (patrz DECISION w
          GalleryPage.module.css). Pływający przycisk filtrów zostaje CELOWO
          poza tym divem: `container-type` włącza layout containment, czyli
          robi z elementu blok zawierający dla potomków `position: fixed` —
          przycisk przestałby być przyklejony do okna i zjeżdżałby ze scrollem. */}
      <div className={styles.pageTrack}>
        <GalleryHeroMolecule
          worksCount={worksCount ?? 0}
          pinnedCount={pinnedCount ?? 0}
          maxPhotos={maxPhotos}
          currentPlan={currentPlan}
          metaState={
            hasPhotos && worksCount !== undefined
              ? 'ready'
              : isPending
                ? 'loading'
                : 'none'
          }
        />

        {/* ── Plan limit notice (only when one place is left or none) ── */}
        {hasPhotos && worksCount !== undefined && (
          <PlanLimitBannerOrganism
            currentPlan={currentPlan}
            photoCount={worksCount}
            maxPhotos={maxPhotos}
          />
        )}

        {/* ── One control row: „Filtry N”, active filters, layout toggle ── */}
        {hasPhotos && (
          <GalleryFilterBarOrganism
            layout={layout}
            onToggleLayout={toggleLayout}
            onInViewChange={setFilterBarInView}
            {...filterSheetProps}
          />
        )}

        {/* ── Photo grid / empty state / no-results state / error ── */}
        {showError ? (
          <ErrorStateMolecule
            message={t('loadError')}
            retryLabel={t('retry')}
            onRetry={() => void refetch()}
            isRetrying={isRefetching}
          />
        ) : isPending ? (
          <GallerySkeletonGridMolecule />
        ) : isEmpty ? (
          <GalleryEmptyStateOrganism onAddPhoto={handleGoToUpload} />
        ) : searchingMorePages &&
          isFetchNextPageError &&
          !isFetchingNextPage ? (
          <ErrorStateMolecule
            message={t('loadError')}
            retryLabel={t('retry')}
            onRetry={() => void fetchNextPage()}
            isRetrying={isFetchingNextPage}
          />
        ) : searchingMorePages && (hasNextPage || isFetchingNextPage) ? (
          <GallerySkeletonGridMolecule />
        ) : filteredRecords.length === 0 ? (
          <EmptyStateAtom
            className={styles.noResultsState}
            title={t('noFilterResults')}
            titleAs='p'
            action={
              <ButtonAtom variant='outlined' size='sm' onClick={clearAll}>
                {t('clearFilters')}
              </ButtonAtom>
            }
          />
        ) : (
          <>
            <div
              className={
                isFullWidth ? styles.galleryGridFullWidth : styles.galleryGrid
              }>
              {filteredRecords.map(record => (
                <OwnGalleryCardItem
                  key={record.gallery_record_id}
                  record={record}
                  isFullWidth={isFullWidth}
                  onCardClick={handleCardClick}
                />
              ))}
            </div>
            <InfiniteScrollTriggerComposition
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              isFetchNextPageError={isFetchNextPageError}
              onFetchNextPage={fetchNextPage}
            />
          </>
        )}
      </div>

      {/* ── Floating filter button: only while the row above is off screen ──
       * DECISION (nie usuwaj): not rendered when the gallery is empty. With
       * zero photos there is nothing to filter, so the button would be a
       * second round control next to the tab bar's QR button with no purpose. */}
      {hasPhotos && (
        <GalleryFloatingFiltersOrganism
          visible={!filterBarInView}
          {...filterSheetProps}
        />
      )}
    </div>
  );
}

export function GalleryPageComposition() {
  const t = useTranslations('pages.gallery');
  return (
    <AppLayoutComposition title={t('myTitle')}>
      <GalleryPageInner />
    </AppLayoutComposition>
  );
}
