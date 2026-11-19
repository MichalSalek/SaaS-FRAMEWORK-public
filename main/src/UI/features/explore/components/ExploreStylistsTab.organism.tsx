/**
 * ExploreStylistsTab: Curated Artisan Directory (thin shell).
 *
 * Browse stylists as creators (not service providers). Hierarchy:
 *  - <AppHero> (title + gold accent, no chip/subtitle)
 *  - StylistsToolbar (search + horizontal city pill rail with edge fade)
 *  - StylistCard grid, StylistsEmptyState, end-of-list caption
 *
 * Flat style: solid color-mix(in oklch) tonal surfaces, full hairline borders,
 * spring easing on hover/active, stagger entrance, dark mode parity.
 * Sub-components live in ExploreStylistsTab.parts.tsx (file-size constraint).
 */

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import type { StylistPublicListItemDTO } from '@kernel/models/public/public.dto';
import { useExploreStylistsList } from '../hooks/useExploreStylistsList';
import { useFetchRemainingPages } from '../../shared/gallery/hooks/useFetchRemainingPages';
import {
  StylistCardOrganism,
  StylistsTabSkeletonMolecule,
  StylistsToolbarMolecule,
  StylistsEmptyStateOrganism,
} from './ExploreStylistsTab.parts.organism';
import { AppHeroOrganism } from '../../../components/AppHero/AppHero.organism';
import { InfiniteScrollTriggerComposition } from '../../../components/InfiniteScrollTrigger.composition';
import { ExploreEditorialErrorOrganism } from '../ExplorePage.parts.organism';
import styles from './ExploreStylistsTab.module.css';

const CITIES = [
  'Wszystkie',
  'Warszawa',
  'Kraków',
  'Gdańsk',
  'Poznań',
  'Wrocław',
  'Łódź',
  'Inne',
] as const;

export function ExploreStylistsTabOrganism() {
  const t = useTranslations('pages.explore');
  const router = useRouter();
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState<string | undefined>(undefined);
  const [selectedCity, setSelectedCity] =
    useState<(typeof CITIES)[number]>('Wszystkie');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setSearchQuery(value.trim() || undefined);
    }, 300);
  };

  // "Inne" = stylists without a recognized city; fetch all and filter client-side.
  // DECISION: pre-launch trade-off. The backend list endpoint supports a single positive `city`
  // filter but has no "notIn [known cities]" predicate, so "Inne" fetches the unfiltered list and
  // excludes the known cities client-side. Acceptable at pre-launch scale; revisit with a
  // server-side exclusion filter if over-fetching for this bucket becomes a cost.
  const isOtherCity = selectedCity === 'Inne';
  const cityFilter =
    selectedCity === 'Wszystkie' || isOtherCity ? undefined : selectedCity;

  const KNOWN_CITIES_LOWER = CITIES.filter(
    c => c !== 'Wszystkie' && c !== 'Inne'
  ).map(c => c.toLowerCase());

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
  } = useExploreStylistsList({ city: cityFilter, searchQuery });

  const allStylists = (() => {
    const raw = data?.pages.flatMap(page => page.stylists) ?? [];
    if (!isOtherCity) {
      return raw;
    }
    return raw.filter(
      s => !s.city || !KNOWN_CITIES_LOWER.includes(s.city.toLowerCase())
    );
  })();

  // „Inne" filters client-side over the loaded pages, and the infinite-scroll
  // sentinel lives only in the results branch: when the first pages hold no
  // stylist outside the listed cities, the empty screen never fetched more.
  // Keep fetching until something appears or the pages run out.
  // Stop on a failed page (hasNextPage stays true, isFetchingNextPage flips
  // back): without the guard this effect retried the failing page in a loop
  // behind a skeleton that never resolved. The failure falls through to the
  // error card below, whose retry re-requests the failed page.
  const searchingOtherCity =
    isOtherCity && !isLoading && allStylists.length === 0;
  useFetchRemainingPages(searchingOtherCity, {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  });

  const handleStylistClick = (stylist: StylistPublicListItemDTO) => {
    void router.push(
      buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
        identifier: stylist.identifier,
      })
    );
  };

  const handleClearFilters = () => {
    // Cancel a pending debounce, or it re-applies the old phrase after clearing.
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = undefined;
    }
    setSearchInput('');
    setSearchQuery(undefined);
    setSelectedCity('Wszystkie');
  };

  // The toolbar stays LIVE while loading: every city/phrase change alters the
  // query key (isLoading=true until the first page), and a dummy with an empty
  // input and no-op handlers dropped typed characters and city taps.
  const toolbar = (
    <StylistsToolbarMolecule
      cities={CITIES}
      selectedCity={selectedCity}
      searchInput={searchInput}
      onCityChange={c => setSelectedCity(c as (typeof CITIES)[number])}
      onSearchChange={handleSearchChange}
      // No total in the list DTO: while more pages exist the loaded count is a
      // lower bound, so it is not presented as „N stylistek".
      resultCount={isLoading || hasNextPage ? 0 : allStylists.length}
    />
  );

  if (
    isLoading ||
    (searchingOtherCity &&
      (isFetchingNextPage || (hasNextPage && !isFetchNextPageError)))
  ) {
    return (
      <section className={styles.section}>
        <AppHeroOrganism
          className={styles.staggerIn}
          title={t('stylistsHeroTitle')}
          accent={t('stylistsHeroTitleAccent')}
        />
        {toolbar}
        <StylistsTabSkeletonMolecule />
      </section>
    );
  }

  return (
    <section className={styles.section}>
      {/* Intro card, <AppHero> canon, without meta (owner, for Explore screens). */}
      <AppHeroOrganism
        className={styles.staggerIn}
        title={t('stylistsHeroTitle')}
        accent={t('stylistsHeroTitleAccent')}
      />

      {toolbar}

      {/* Body: error | empty | grid.
       *
       * DECISION: see main/src/UI/features/explore/ExplorePage.composition.tsx (error banner only
       * without cached data); here the same rule for the stylists tab. */}
      {isError && allStylists.length === 0 ? (
        <ExploreEditorialErrorOrganism
          onRetry={() =>
            void (isFetchNextPageError ? fetchNextPage() : refetch())
          }
          isFetching={isFetching}
          title={t('stylistsErrorTitle')}
          hint={t('stylistsErrorHint')}
        />
      ) : allStylists.length === 0 ? (
        <StylistsEmptyStateOrganism onClear={handleClearFilters} />
      ) : (
        <>
          <div className={styles.cardList}>
            {allStylists.map((stylist, i) => (
              <StylistCardOrganism
                key={stylist.account_id}
                stylist={stylist}
                staggerIndex={Math.min(i, 8) + 2}
                onOpen={handleStylistClick}
              />
            ))}
          </div>

          {isFetchingNextPage && <StylistsTabSkeletonMolecule />}

          {!hasNextPage && !isFetchingNextPage && allStylists.length > 4 && (
            <div className={styles.endOfList}>
              <span>{t('stylistsEndOfList')}</span>
            </div>
          )}

          <InfiniteScrollTriggerComposition
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            isFetchNextPageError={isFetchNextPageError}
            onFetchNextPage={fetchNextPage}
            showSpinner={false}
          />
        </>
      )}
    </section>
  );
}
