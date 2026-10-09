/**
 * StylistGalleryPage — Public/paired stylist portfolio exhibit (W2 iter 1).
 *
 * Mood: "Stylist's exhibition — entering a curator's studio".
 * The most "Behance-like" view in the app — public-ish portfolio browsed by a
 * client who is either paired (full gallery) or not (pinned works only).
 *
 * Hierarchy:
 *  - StylistExhibitHero (solid cover band + avatar overlap + meta + stats)
 *  - StylistActionPanel (unpaired-only pairing CTA — the ONLY pairing
 *    affordance on this screen since the dead „N ukrytych prac" teaser under
 *    the grid was removed; rationale in useStylistGalleryPage)
 *  - StylistPortfolioSection (eyebrow + count + filters + masonry/full-width grid)
 *  - Branded empty/error states
 *
 * Shared visual vocabulary with Dashboard / Gallery / Sessions / Photo Detail /
 * Explore / Favorites / Shared: eyebrow chip, solid tonal surfaces, full
 * hairline borders, ZERO shadow / glow / gradient (anti-slop floor), spring
 * easing, dark mode parity.
 */

import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { ChipAtom } from '../../components/Chip/Chip.atom';
import { GalleryFilterBarOrganism } from './components/GalleryFilterBar.organism';
import { GalleryFloatingFiltersOrganism } from './components/GalleryFloatingFilters.organism';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { useViewTransitionRouter } from '../../layouts/useViewTransitionRouter';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { useAddPhotoToSession } from '../shared/sessions/hooks/useAddPhotoToSession';
import { useSessionPickFavorites } from './hooks/useSessionPickFavorites';
import { StylistExhibitHeroOrganism } from './StylistExhibitHero.organism';
import {
  StylistExhibitHeroSkeletonMolecule,
  StylistActionPanelOrganism,
  StylistEmptyStateOrganism,
  StylistErrorStateOrganism,
  StylistGallerySkeletonGridMolecule,
  SessionPickBannerAtom,
} from './StylistGalleryPage.parts.organism';
import { StylistPortfolioSectionOrganism } from './components/StylistPortfolioSection.organism';
import { useStylistGalleryPage } from './hooks/useStylistGalleryPage';
import { useGalleryFiltersUrl } from './hooks/useGalleryFiltersUrl';
import { useGalleryReturnPosition } from './hooks/useGalleryReturnPosition';
import { useGalleryLayout } from '../../shared/hooks/useGalleryLayout';
import styles from './StylistGalleryPage.module.css';

/* ─── Types ─── */

interface StylistGalleryPageProps {
  stylistId: string;
}

/* ─── Main component ─── */

export function StylistGalleryPageComposition({
  stylistId,
}: StylistGalleryPageProps) {
  const t = useTranslations('pages.gallery');
  return (
    <AppLayoutComposition title={t('stylistGalleryTitle')}>
      <StylistGalleryPageInner stylistId={stylistId} />
    </AppLayoutComposition>
  );
}

function StylistGalleryPageInner({ stylistId }: StylistGalleryPageProps) {
  const t = useTranslations('pages.gallery');
  const router = useRouter();
  const navigate = useViewTransitionRouter();

  /* ── Session pick mode — client navigated here with ?addToSession={sessionId} ── */
  const addToSessionId =
    typeof router.query.addToSession === 'string'
      ? router.query.addToSession
      : null;
  const isSessionPickMode = addToSessionId !== null;
  const addPhotoMutation = useAddPhotoToSession(addToSessionId ?? '');

  /* ── Most lajki → sesja: „tylko polubione” w trybie wyboru zdjęcia ── */
  const {
    favoritesOnly,
    toggleFavoritesOnly,
    effectiveFavoritesOnly,
    favoritedRecordIdsForStylist,
    stylistFavoritesCount,
  } = useSessionPickFavorites(stylistId, isSessionPickMode);

  /* ── Layout toggle (SSOT §4.2: galleries default to single column full-width) ── */
  const { layout, toggleLayout } = useGalleryLayout('stylist-gallery');

  /* ── Page state (gallery, filters, favorites, stats, locked teaser) ── */
  const {
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
    favoritedIds,
    isFavoriteResolved,
    favoritesFailed,
    retryFavorites,
    isRetryingFavorites,
    handleToggleFavorite,
    showWatermark,
    uniqueColors,
    uniqueStyles,
  } = useStylistGalleryPage(stylistId);

  /* ── Filters live in the address, the list position is remembered: a return
   *    from a photo lands on the same filtered list at the same place. The
   *    address is replayed only once the page knows WHICH gallery it shows
   *    (public or paired), i.e. after the pairing check. ── */
  const filtersReady = useGalleryFiltersUrl(
    { filters, toggleColor, toggleTrait, toggleLength, setExactMatch },
    !isLoading && !isError
  );
  const isPending = isLoading || !filtersReady;
  useGalleryReturnPosition(`stylist-gallery:${stylistId}`, !isPending);
  const [filterBarInView, setFilterBarInView] = useState(true);

  /* ── AppBar title ── */
  const displayName =
    stylistInfo?.display_name ?? stylistInfo?.business_name ?? null;
  useAppBarTitle(
    displayName
      ? t('galleryTitleWithName', { name: displayName })
      : t('galleryTitle')
  );

  /* ── Action panel + session pick handlers ── */
  const handlePair = () => {
    navigate(ROUTES_FRONT.PAIRING);
  };

  const handlePickPhotoForSession = (galleryRecordId: string) => {
    if (!addToSessionId) {
      return;
    }
    addPhotoMutation.mutate(galleryRecordId);
  };

  /* ── Error / Loading states ── */
  if (isError) {
    return (
      <div className={styles.page}>
        <StylistErrorStateOrganism
          onRetry={retryGallery}
          isRetrying={isRetryingGallery}
          onBack={() => navigate('back')}
        />
      </div>
    );
  }

  if (isPending) {
    return (
      <div className={styles.page}>
        <StylistExhibitHeroSkeletonMolecule />
        <StylistGallerySkeletonGridMolecule />
      </div>
    );
  }

  const resolvedName = displayName ?? '—';
  const businessName = stylistInfo?.business_name ?? null;
  const city = stylistInfo?.address_city ?? null;
  // DECISION (nie usuwaj tego komentarza):
  // gallery `stylist_info` DTO (PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT /
  // GET_GALLERY_RECORDS / paired) nie zawiera `instagram_handle` — pole żyje
  // tylko w account/public DTO. Wcześniejszy `'instagram_handle' in stylistInfo`
  // + cast był martwą gałęzią (zawsze null). Hero przyjmuje instagram?:string|null,
  // więc przekazujemy null (IG-blok się nie renderuje — bez zmiany zachowania).
  // Gdy gallery DTO zacznie zwracać IG, podłącz `stylistInfo.instagram_handle`.
  const instagram: string | null = null;

  // W pick-mode + „tylko ulubione": zawężamy TO, CO renderuje portfolio, do
  // polubionych tej stylistki (przecięcie z aktywnymi filtrami koloru/cechy).
  const pickDisplayedRecords =
    isSessionPickMode && effectiveFavoritesOnly
      ? displayedRecords.filter(r =>
          favoritedRecordIdsForStylist.has(r.gallery_record_id)
        )
      : displayedRecords;

  const isNarrowed =
    totalActiveFilters > 0 || (isSessionPickMode && effectiveFavoritesOnly);
  // One set of filter props for both entries (the row and the floating button).
  const filterSheetProps = {
    allColors: availableColors,
    allTraits: availableTraits,
    allNailLengths,
    availableColors,
    availableTraits,
    availableNailLengths,
    selectedColors: filters.selectedColors,
    selectedTraits: filters.selectedTraits,
    selectedLength: filters.selectedLength,
    exactMatch: filters.exactMatch,
    matchingCount: filteredRecords.length,
    resultsIncomplete: galleryIncomplete,
    totalActiveFilters,
    onToggleColor: toggleColor,
    onToggleTrait: toggleTrait,
    onToggleLength: toggleLength,
    onExactMatchChange: setExactMatch,
    onClearAll: clearAll,
  };

  return (
    <div className={styles.page}>
      {isSessionPickMode && <SessionPickBannerAtom />}

      {/* Most lajki → sesja: przełącznik widoczny tylko gdy klientka MA polubione
          zdjęcia tej stylistki (inaczej nie ma czego filtrować). */}
      {isSessionPickMode && stylistFavoritesCount > 0 && (
        <div className={styles.favoritesFilterRow}>
          <ChipAtom
            size='md'
            label={t('sessionPick.favoritesOnly', {
              count: stylistFavoritesCount,
            })}
            selected={favoritesOnly}
            onClick={toggleFavoritesOnly}
          />
        </div>
      )}

      <StylistExhibitHeroOrganism
        stylistId={stylistId}
        displayName={resolvedName}
        businessName={businessName}
        city={city}
        instagram={instagram}
        brandAccentColor={stylistInfo?.brand_accent_color ?? null}
        isPaired={usePaired}
        totalCount={allRecords.length}
        uniqueColors={uniqueColors}
        uniqueStyles={uniqueStyles}
      />

      {/* A failed pairing check falls back to the public portfolio. Say so
          (with a retry) instead of presenting the pinned works as everything
          and inviting an already paired client to pair. */}
      {pairingCheckFailed && (
        <ErrorStateMolecule
          message={t('pairingStatusError')}
          retryLabel={t('retry')}
          onRetry={retryPairingCheck}
          isRetrying={isRetryingPairingCheck}
        />
      )}

      {/* Action panel hidden in session pick mode (user is here to select a
       * photo) AND when paired — status parowania komunikuje już badge
       * „Sparowano" na hero; druga zielona karta dublowała status i spychała
       * galerię w dół (census S26). Panel zostaje tylko jako CTA „Sparuj się"
       * dla niesparowanych. */}
      {!isSessionPickMode && !usePaired && !pairingCheckFailed && (
        <StylistActionPanelOrganism
          isLoggedInClient={isLoggedInClient}
          onPair={handlePair}
        />
      )}

      {/* Stan serc nierozstrzygnięty przez błąd ulubionych: mówimy to wprost
          i dajemy ponowienie, zamiast pokazywać puste serca jako „nie".
          Także w pick-mode: ten sam cache ulubionych zasila tam filtr „tylko
          ulubione", a dociąganie stron staje po błędzie, więc bez ponowienia
          filtr i licznik zostawały zaniżone do końca wizyty. */}
      {favoritesFailed && (
        <ErrorStateMolecule
          message={t('favoritesStateError')}
          retryLabel={t('retry')}
          onRetry={retryFavorites}
          isRetrying={isRetryingFavorites}
        />
      )}

      {allRecords.length > 0 ? (
        <StylistPortfolioSectionOrganism
          filterBar={
            <GalleryFilterBarOrganism
              layout={layout}
              onToggleLayout={toggleLayout}
              onInViewChange={setFilterBarInView}
              {...(isNarrowed
                ? {
                    resultSummary: t('filterResultSummary', {
                      shown: pickDisplayedRecords.length,
                      total: allRecords.length,
                    }),
                  }
                : {})}
              {...filterSheetProps}
            />
          }
          displayedRecords={pickDisplayedRecords}
          clearAll={clearAll}
          layout={layout}
          usePaired={usePaired}
          showWatermark={showWatermark}
          favoritedIds={favoritedIds}
          isFavoriteResolved={isFavoriteResolved}
          canFavorite={isLoggedInClient}
          onFavoriteToggle={handleToggleFavorite}
          isSessionPickMode={isSessionPickMode}
          {...(isSessionPickMode
            ? { onPickPhotoForSession: handlePickPhotoForSession }
            : {})}
        />
      ) : galleryPageFailed ? null : (
        <StylistEmptyStateOrganism />
      )}

      {galleryPageFailed && (
        <ErrorStateMolecule
          message={t('stylistGalleryPartialError')}
          retryLabel={t('retry')}
          onRetry={retryGalleryPage}
          isRetrying={isRetryingGalleryPage}
        />
      )}

      {/* Floating filter button: only while the row above is off screen. */}
      {allRecords.length > 0 && (
        <GalleryFloatingFiltersOrganism
          visible={!filterBarInView}
          {...filterSheetProps}
        />
      )}
    </div>
  );
}
