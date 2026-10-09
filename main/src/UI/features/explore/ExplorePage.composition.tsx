import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import { GalleryQuickFiltersOrganism } from '../../components/GalleryQuickFilters/GalleryQuickFilters.organism';
import { useNailLengthOptions } from '../shared/gallery/nailLengthOptions.config';
import { GalleryFilterSectionOrganism } from '../../components/GalleryFilterSection/GalleryFilterSection.organism';
import { GalleryLayoutToggleAtom } from '../../components/GalleryLayoutToggle/GalleryLayoutToggle.atom';
import { InputAtom } from '../../components/Input/Input.atom';
import { useExploreGallery } from './hooks/useExploreGallery';
import { useRecordFavorites } from '../shared/gallery/hooks/useRecordFavorites';
import { useGalleryFilters } from './hooks/useGalleryFilters';
import { useGalleryLayout } from '../../shared/hooks/useGalleryLayout';
import { useGalleryFilterOptions } from '../shared/gallery/hooks/useGalleryFilterOptions';
import {
  useScrollRestoration,
  useDebouncedSearch,
  saveScrollPosition,
} from './hooks/useExploreHelpers';
import { ExploreGalleryGridOrganism } from './components/ExploreGalleryGrid.organism';
import {
  ExploreSkeletonMasonryMolecule,
  ExploreEditorialEmptyOrganism,
  ExploreEditorialErrorOrganism,
  ExploreEndOfFeedMolecule,
  ExploreActiveFilterChipsMolecule,
  type ExploreTab,
} from './ExplorePage.parts.organism';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import {
  EXPLORE_TAB_QUERY_PARAM,
  parseExploreTabQuery,
} from './exploreTab.query';
import styles from './ExplorePage.module.css';

// C-perf-27: Stylists tab lazy-loaded. Default tab to 'styles', wiec chunk Stylists
// (+ jego drzewo zaleznosci) jest pobierany dopiero gdy user przelaczy zakladke.
// ssr:false — tab renderowany wylacznie po stronie klienta (activeTab state, init 'styles').
const ExploreStylistsTab = dynamic(
  () =>
    import('./components/ExploreStylistsTab.organism').then(
      m => m.ExploreStylistsTabOrganism
    ),
  {
    ssr: false,
    // Opakowanie w `.pageTrack` jest KONIECZNE: kontener `app-view` siedzi na
    // `.pageTrack` wewnątrz gałęzi „stylizacje", a ten fallback renderuje się
    // jako RODZEŃSTWO tamtego diva (gałąź „stylistki"). Bez wrappera progi
    // kolumn `.skeletonMasonry` nie mają przodka do odpytania i szkielet stoi
    // na dwóch kolumnach niezależnie od szerokości toru.
    loading: () => (
      <div className={styles.pageTrack}>
        <ExploreSkeletonMasonryMolecule />
      </div>
    ),
  }
);

export function ExplorePageComposition() {
  const t = useTranslations('pages.explore');
  return (
    <AppLayoutComposition title={t('title')}>
      <ExplorePageInner />
    </AppLayoutComposition>
  );
}

function ExplorePageInner() {
  const t = useTranslations('pages.explore');
  const router = useRouter();
  const nailLengthOptions = useNailLengthOptions();
  useScrollRestoration();

  // Deep link `?tab=stylists` (DECISION in exploreTab.query). Client-side
  // arrivals (the /app/stylists redirect) already have the query on the first
  // render, so the initializer opens the right tab without a flash; a cold load
  // of the static page gets the query only once the router is ready, hence the
  // effect. It runs when the REQUESTED tab changes, so a manual switch after
  // landing is never overridden.
  const requestedTab = parseExploreTabQuery(
    router.query[EXPLORE_TAB_QUERY_PARAM]
  );
  const [activeTab, setActiveTab] = useState<ExploreTab>(
    () => requestedTab ?? 'styles'
  );
  useEffect(() => {
    if (requestedTab !== null) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  const {
    filters,
    toggleColor,
    toggleTrait,
    toggleNailLength,
    setSearchQuery,
    setExactMatch,
    clearAll,
    totalActiveFilters,
  } = useGalleryFilters();

  const { layout, isFullWidth, toggleLayout } = useGalleryLayout('explore');

  const { colors, traits, optionsLoadFailed, retryOptions } =
    useGalleryFilterOptions();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useExploreGallery(filters);

  const { favoritedIds, handleFavoriteToggle } = useRecordFavorites(
    data?.pages
  );

  const { searchInput, resetSearch, handleSearchChange } =
    useDebouncedSearch(setSearchQuery);

  const allRecords = data?.pages.flatMap(p => p.records) ?? [];
  const matchingCount = allRecords.length;
  const selectedLength = filters.nail_length ?? null;
  const handleCardClick = (recordId: string) => {
    saveScrollPosition();
    void router.push(buildRoute(ROUTES_FRONT.PHOTO_DETAIL, { id: recordId }));
  };

  const handleClearAll = () => {
    clearAll();
    resetSearch();
  };

  return (
    <div className={styles.page}>
      <SegmentedControlMolecule
        semantics='tabs'
        size='md'
        shape='pill'
        fullWidth
        ariaLabel={t('title')}
        value={activeTab}
        onChange={setActiveTab}
        options={[
          {
            value: 'styles',
            id: 'tab-styles',
            controls: 'panel-styles',
            label: t('tabStyles'),
          },
          {
            value: 'stylists',
            id: 'tab-stylists',
            controls: 'panel-stylists',
            label: t('tabStylists'),
          },
        ]}
      />

      {/* DECISION (nie usuwaj tego komentarza):
       * Single tabpanel element (content swapped by `activeTab`, re-mounted via
       * `key`) — so its `id`/`aria-labelledby` are derived from the active tab
       * rather than rendering two static panels. Each tab's `aria-controls`
       * targets the panel id that exists while that tab is active. */}
      <div
        key={activeTab}
        role='tabpanel'
        id={activeTab === 'styles' ? 'panel-styles' : 'panel-stylists'}
        aria-labelledby={activeTab === 'styles' ? 'tab-styles' : 'tab-stylists'}
        className={styles.tabContent}>
        {activeTab === 'stylists' ? (
          <ExploreStylistsTab />
        ) : (
          <>
            {/* Tor treści = kontener zapytań rozmiarowych (patrz DECISION w
                ExplorePage.module.css). Pływający FAB filtrów zostaje CELOWO
                poza tym divem: `container-type` włącza layout containment,
                czyli robi z elementu blok zawierający dla potomków
                `position: fixed` — dokładnie ta klasa buga, przed którą
                ostrzega DECISION przy `.tabContent`. */}
            <div className={styles.pageTrack}>
              {/* Karta-intro — kanon <AppHero> (S25/1 wariant D): tytuł +
               * złoty akcent, bez chipa/subtitle/pills (głos ownera). */}
              <AppHeroOrganism
                className={styles.staggerIn}
                title={t('stylesHeroTitle')}
                accent={t('stylesHeroTitleAccent')}
              />

              <div
                className={`${styles.searchRow} ${styles.staggerIn}`}
                style={{ '--stagger-index': 1 } as React.CSSProperties}>
                <InputAtom
                  type='search'
                  aria-label={t('searchAriaLabel')}
                  placeholder={t('searchPlaceholder')}
                  value={searchInput}
                  onChange={handleSearchChange}
                />
              </div>

              <div
                className={`${styles.quickFilterWrap} ${styles.staggerIn}`}
                style={{ '--stagger-index': 2 } as React.CSSProperties}>
                <GalleryQuickFiltersOrganism
                  availableColors={colors}
                  availableTraits={traits}
                  availableNailLengths={nailLengthOptions}
                  selectedColors={filters.color_ids}
                  selectedTraits={filters.trait_ids}
                  selectedLength={selectedLength}
                  onToggleColor={toggleColor}
                  onToggleTrait={toggleTrait}
                  onToggleLength={toggleNailLength}
                />
              </div>

              {/* Active filter chips (deletable) */}
              {totalActiveFilters > 0 && (
                <ExploreActiveFilterChipsMolecule
                  colorIds={filters.color_ids}
                  traitIds={filters.trait_ids}
                  selectedLength={selectedLength}
                  onToggleColor={toggleColor}
                  onToggleTrait={toggleTrait}
                  onToggleLength={toggleNailLength}
                />
              )}

              {/* Layout toggle (tile vs full-width single column) */}
              {!isLoading && !isError && matchingCount > 0 && (
                <div className={styles.layoutToggleRow}>
                  <GalleryLayoutToggleAtom
                    layout={layout}
                    onToggle={toggleLayout}
                  />
                </div>
              )}

              {/* ── Body: loading | error | empty | grid ──
               *
               * DECISION (nie usuwaj tego komentarza):
               * Error state shows only when isError AND no cached data — avoids
               * flashing the error card while a transient 401 during route
               * transition re-resolves (TQ keeps isError true briefly even after
               * successful refetch). When records exist, prefer showing them
               * over error noise.
               */}
              {isLoading ? (
                <ExploreSkeletonMasonryMolecule />
              ) : isError && allRecords.length === 0 ? (
                <ExploreEditorialErrorOrganism
                  onRetry={() => void refetch()}
                  isFetching={isFetching}
                />
              ) : allRecords.length === 0 ? (
                <ExploreEditorialEmptyOrganism
                  onClearFilters={handleClearAll}
                  hasFiltersActive={totalActiveFilters > 0}
                />
              ) : (
                <>
                  <ExploreGalleryGridOrganism
                    records={allRecords}
                    isFullWidth={isFullWidth}
                    hasNextPage={hasNextPage ?? false}
                    isFetchingNextPage={isFetchingNextPage}
                    isFetchNextPageError={isFetchNextPageError}
                    favoritedIds={favoritedIds}
                    onFetchNextPage={fetchNextPage}
                    onFavoriteToggle={handleFavoriteToggle}
                    onCardClick={handleCardClick}
                  />
                  {hasNextPage === false && !isFetchingNextPage && (
                    <ExploreEndOfFeedMolecule />
                  )}
                </>
              )}
            </div>

            {/* Floating filter FAB (always available — even on empty) */}
            <GalleryFilterSectionOrganism
              allColors={colors}
              allTraits={traits}
              allNailLengths={nailLengthOptions}
              availableColors={colors}
              availableTraits={traits}
              availableNailLengths={nailLengthOptions}
              selectedColors={filters.color_ids}
              selectedTraits={filters.trait_ids}
              selectedLength={selectedLength}
              exactMatch={filters.apply_strict_filter}
              matchingCount={matchingCount}
              // Server-side filtering: the count is the LOADED page(s) only,
              // and while a filter change is in flight it is 0. Neither is a
              // confirmed „no matches".
              resultsIncomplete={hasNextPage || isFetching}
              optionsLoadFailed={optionsLoadFailed}
              onRetryOptions={retryOptions}
              totalActiveFilters={totalActiveFilters}
              onToggleColor={toggleColor}
              onToggleTrait={toggleTrait}
              onToggleLength={toggleNailLength}
              onExactMatchChange={setExactMatch}
              onClearAll={handleClearAll}
            />
          </>
        )}
      </div>
    </div>
  );
}
