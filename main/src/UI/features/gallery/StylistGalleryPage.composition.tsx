import { useStylistSalonScope } from './hooks/useStylistSalonScope';
import { brandScopeProps } from '../shared/branding/brandScope';
import { SalonGalleryOrganism } from '../salon-profile/SalonGallery.organism';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { ChipAtom } from '../../components/Chip/Chip.atom';
import { GalleryFilterBarOrganism } from './components/GalleryFilterBar.organism';
import { GalleryFloatingFiltersOrganism } from './components/GalleryFloatingFilters.organism';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { useViewTransitionRouter } from '../../layouts/useViewTransitionRouter';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { useSessionPhotoPicker } from '../shared/sessions/hooks/useSessionPhotoPicker';
import { SessionPickBarMolecule } from './components/SessionPickBar.molecule';
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
import { useGalleryLayout } from '../../shared/hooks/useGalleryLayout';
import styles from './StylistGalleryPage.module.css';

interface StylistGalleryPageProps {
  stylistId: string;
}

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
  const tLabels = useTranslations('labels');
  const { addToSession } = useRouter().query;
  const { salon, scopeControl, showSalon, hasSalonAccess } =
    useStylistSalonScope(stylistId);
  const navigate = useViewTransitionRouter();

  const addToSessionId = typeof addToSession === 'string' ? addToSession : null;
  const isSessionPickMode = addToSessionId !== null;
  const picker = useSessionPhotoPicker(addToSessionId ?? '');

  const {
    favoritesOnly,
    toggleFavoritesOnly,
    effectiveFavoritesOnly,
    favoritedRecordIdsForStylist,
    stylistFavoritesCount,
  } = useSessionPickFavorites(stylistId, isSessionPickMode);

  const { layout, toggleLayout } = useGalleryLayout('stylist-gallery');

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
    audience,
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

  const filtersReady = useGalleryFiltersUrl(
    { filters, toggleColor, toggleTrait, toggleLength, setExactMatch },
    !isLoading && !isError
  );
  const isPending = isLoading || !filtersReady;
  const [filterBarInView, setFilterBarInView] = useState(true);

  const displayName =
    stylistInfo?.display_name ?? stylistInfo?.business_name ?? null;
  useAppBarTitle(
    displayName
      ? t('galleryTitleWithName', { name: displayName })
      : t('galleryTitle')
  );

  const pickBar = isSessionPickMode ? (
    <SessionPickBarMolecule
      sessionId={addToSessionId ?? ''}
      pickedCount={picker.pickedCount}
      isReady={picker.isReady}
    />
  ) : null;

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

  // A stylist who skipped the profile card has no name yet; the hero
  // showed a bare dash (and a dash as the avatar's initials).
  const resolvedName = displayName?.trim() || tLabels('stylistFallback');
  const businessName = stylistInfo?.business_name ?? null;
  const city = stylistInfo?.address_city ?? null;
  // The gallery `stylist_info` DTO (PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT / GET_GALLERY_RECORDS /
  // paired) has no `instagram_handle`; the field lives only in the account/public DTO. The hero
  // takes instagram?: string | null, so null is passed (the IG block does not render). When the
  // gallery DTO starts returning IG, wire `stylistInfo.instagram_handle` here.
  const instagram: string | null = null;

  // In pick mode + „tylko ulubione": narrow WHAT the portfolio renders to this
  // stylist's liked works (intersected with the active colour/trait filters).
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

  if (salon && showSalon) {
    return (
      <div className={styles.page} data-fill-shell=''>
        {scopeControl}
        {isSessionPickMode && (
          <SessionPickBannerAtom isShared={picker.isShared} />
        )}
        {!isSessionPickMode && audience === 'clientPaired' && (
          <StylistActionPanelOrganism
            audience={audience}
            stylistId={stylistId}
          />
        )}
        <SalonGalleryOrganism
          salonAccountId={salon.account_id}
          {...(isSessionPickMode ? { sessionPicker: picker } : {})}
          publicOnly={!usePaired && !hasSalonAccess}
        />
        {pickBar}
      </div>
    );
  }

  return (
    <div
      {...brandScopeProps(stylistInfo?.brand_accent_color, styles.page)}
      data-fill-shell=''>
      {scopeControl}
      {isSessionPickMode && (
        <SessionPickBannerAtom isShared={picker.isShared} />
      )}

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

      {/* While she chooses photos the stylist's card is left out: the bar
          above already names the gallery, and the card stood between her and
          the first photo (measured: 600px down on a phone). */}
      {!isSessionPickMode && (
        <StylistExhibitHeroOrganism
          displayName={resolvedName}
          businessName={businessName}
          city={city}
          instagram={instagram}
          isPaired={usePaired}
          totalCount={allRecords.length}
          uniqueColors={uniqueColors}
          uniqueStyles={uniqueStyles}
        />
      )}

      {pairingCheckFailed && (
        <ErrorStateMolecule
          message={t('pairingStatusError')}
          retryLabel={t('retry')}
          onRetry={retryPairingCheck}
          isRetrying={isRetryingPairingCheck}
        />
      )}

      {!isSessionPickMode && (
        <StylistActionPanelOrganism audience={audience} stylistId={stylistId} />
      )}

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
          {...(isSessionPickMode ? { sessionPicker: picker } : {})}
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

      {allRecords.length > 0 && (
        <GalleryFloatingFiltersOrganism
          visible={!filterBarInView}
          aboveBar={isSessionPickMode}
          {...filterSheetProps}
        />
      )}
      {pickBar}
    </div>
  );
}
