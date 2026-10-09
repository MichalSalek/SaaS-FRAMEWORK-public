/**
 * StyleDetailPage — Single style taxonomy view (W2.5 iter 1).
 *
 * Mood: "Curator's lens on one beauty signature".
 * Klientka klika "Boho" w filter -> ląduje tu i widzi single style
 * jako TEMAT: portrety, motyw, kolekcja, kontekst — nie generic filter result.
 *
 * Reference anchoring:
 *  - NYT Special Section hero (large title + subtitle + theme image)
 *  - VSCO grid by tag (masonry, variable heights, hover lift)
 *  - Wikipedia article intro (h1 + description + meta)
 *  - Spotify "Fans also like" (carousel of related style chips)
 *
 * Hierarchy:
 *  - StyleDetailHero — eyebrow STYL + category badge + large name + stats
 *    pills (żywe dane) + decorative category-specific bg pattern
 *  - StyleDetailLengthFilter — length filter strip (chips with counts)
 *  - StyleDetailGallerySection — masonry CSS columns + infinite scroll
 *  - StyleDetailRelatedRow — Spotify "Fans also like" related styles
 *  - Branded empty / not-found / error states
 *
 * Patterns inherited (W1+W2):
 *  - Eyebrow chip + gold dot, OKLCH layered shadows, spring easing
 *  - Sparkle SVG mask vocabulary, dark mode parity, reduced motion
 *  - Stagger entrance, container queries (phone-frame mode)
 */

import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import type { TraitCategoryValue } from '@kernel/domain/admin/traits.config';
import { usePublicFeatureFlag } from '../../../application/feature-flags/client-feature-flags';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { useRecordFavorites } from '../shared/gallery/hooks/useRecordFavorites';
import { useStyleDetailData } from './hooks/useStyleDetailData';
import { StyleDetailHeroOrganism } from './StyleDetailHero.organism';
import {
  StyleDetailLengthFilterMolecule,
  StyleDetailGallerySectionOrganism,
} from './StyleDetailGallery.organism';
import {
  StyleDetailRelatedRowOrganism,
  StyleDetailEmptyStateOrganism,
  StyleDetailErrorStateOrganism,
  StyleDetailNotFoundStateOrganism,
  StyleDetailNoLengthResultsOrganism,
  StyleDetailSkeletonMolecule,
  type RelatedStyleItem,
} from './StyleDetailPage.parts.organism';
import styles from './StyleDetailPage.module.css';

/* ─── Related styles composition ──────────────────────────
 * Same-category first (max 4), then cross-category (max 4) for breadth. */

const MAX_RELATED_SAME = 4;
const MAX_RELATED_CROSS = 4;

interface RelatedTrait {
  id: string;
  name: string;
  category: TraitCategoryValue | undefined;
}

function pickRelated(
  currentId: string,
  currentCategory: TraitCategoryValue | undefined,
  allTraits: readonly RelatedTrait[]
): RelatedStyleItem[] {
  const others = allTraits.filter(tr => tr.id !== currentId);
  const sameCategory =
    currentCategory !== undefined
      ? others.filter(tr => tr.category === currentCategory)
      : [];
  const crossCategory = others.filter(tr => tr.category !== currentCategory);

  const byName = (a: RelatedTrait, b: RelatedTrait) =>
    a.name.localeCompare(b.name);

  const pickedSame = [...sameCategory].sort(byName).slice(0, MAX_RELATED_SAME);
  const pickedCross = [...crossCategory]
    .sort(byName)
    .slice(0, MAX_RELATED_CROSS);

  return [...pickedSame, ...pickedCross].map(tr => ({
    id: tr.id,
    name: tr.name,
    category: tr.category,
  }));
}

/* ─── Page entry ──────────────────────────────────────── */

interface StyleDetailPageProps {
  styleId: string;
}

export function StyleDetailPageComposition({ styleId }: StyleDetailPageProps) {
  const t = useTranslations('pages.gallery');
  return (
    <AppLayoutComposition title={t('styleDetailGalleryTitle')}>
      <StyleDetailPageInner styleId={styleId} />
    </AppLayoutComposition>
  );
}

function StyleDetailPageInner({ styleId }: StyleDetailPageProps) {
  const t = useTranslations('pages.gallery');
  const router = useRouter();

  const {
    currentTrait,
    allTraits,
    traitsLoading,
    traitsError,
    refetchTraits,
    records,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isLoading,
    isError,
    refetch,
    selectedLength,
    setSelectedLength,
    clearLength,
    lengthCounts,
    uniqueStylists,
    uniqueColors,
  } = useStyleDetailData(styleId);

  /* AppBar title — show style name once known. */
  useAppBarTitle(currentTrait?.name ?? t('styleDetailGalleryTitle'));

  /* Favoriting wiring — same explore query as Explore, so the same overrides
     over the server flag (a tap wins until the refetch agrees with it). */
  const favoritePages = useMemo(() => [{ records }], [records]);
  const { favoritedIds, handleFavoriteToggle: handleToggleFavorite } =
    useRecordFavorites(favoritePages);

  const handlePhotoClick = (recordId: string) => {
    void router.push(buildRoute(ROUTES_FRONT.PHOTO_DETAIL, { id: recordId }));
  };

  const handleRelatedSelect = (id: string) => {
    void router.push(buildRoute(ROUTES_FRONT.STYLE_DETAIL, { id }));
  };

  const handleLengthSelect = (length: NailLength | null) => {
    if (length === null) {
      clearLength();
      return;
    }
    setSelectedLength(selectedLength === length ? null : length);
  };

  // EXPLORE_ENABLED (kernel default OFF): /app/explore 404s while parked, so the
  // "back to explore" escape from the state cards must fall back to the dashboard.
  // Runtime-reactive — routes back to explore once an admin enables the flag.
  const exploreEnabled = usePublicFeatureFlag(
    FEATURE_FLAG_KEYS.EXPLORE_ENABLED
  );
  const handleBackToExplore = () => {
    void router.push(exploreEnabled ? ROUTES_FRONT.EXPLORE : ROUTES_FRONT.APP);
  };

  const handleRetry = () => {
    void refetch();
  };

  const handleFetchNext = () => {
    void fetchNextPage();
  };

  /* Related items. */
  const relatedItems = !currentTrait
    ? []
    : pickRelated(currentTrait.id, currentTrait.category, allTraits);

  /* ─── Render ─── */

  /* Loading first paint — full skeleton. */
  if (isLoading && !currentTrait) {
    return (
      <div className={styles.page}>
        <StyleDetailSkeletonMolecule />
      </div>
    );
  }

  /* Traits fetch error — full-page error. Retry must refetch the TRAITS: the
   * records query is disabled until the trait resolves, so `refetch` of it
   * (the old wiring) was a dead button. */
  if (traitsError) {
    return (
      <div className={styles.page}>
        <StyleDetailErrorStateOrganism
          onRetry={() => void refetchTraits()}
          onBackToExplore={handleBackToExplore}
        />
      </div>
    );
  }

  /* Not found — trait list loaded but no match. */
  if (!traitsLoading && !currentTrait) {
    return (
      <div className={styles.page}>
        <StyleDetailNotFoundStateOrganism
          onBackToExplore={handleBackToExplore}
        />
      </div>
    );
  }

  /* Records fetch error (trait exists but explore call failed). */
  if (isError && currentTrait) {
    return (
      <div className={styles.page}>
        <StyleDetailHeroOrganism
          traitName={currentTrait.name}
          category={currentTrait.category}
          totalPhotos={0}
          uniqueStylists={0}
          uniqueColors={0}
        />
        <StyleDetailErrorStateOrganism
          onRetry={handleRetry}
          onBackToExplore={handleBackToExplore}
        />
      </div>
    );
  }

  /* currentTrait is guaranteed non-null below this point. */
  if (!currentTrait) {
    return null;
  }

  const hasAnyRecords = records.length > 0;

  return (
    <div className={styles.page}>
      <StyleDetailHeroOrganism
        traitName={currentTrait.name}
        category={currentTrait.category}
        totalPhotos={records.length}
        uniqueStylists={uniqueStylists}
        uniqueColors={uniqueColors}
        isPartial={hasNextPage === true}
      />

      {(hasAnyRecords || selectedLength !== null) && (
        <StyleDetailLengthFilterMolecule
          selectedLength={selectedLength}
          lengthCounts={lengthCounts}
          hasNextPage={hasNextPage}
          onSelect={handleLengthSelect}
        />
      )}

      {hasAnyRecords ? (
        <StyleDetailGallerySectionOrganism
          records={records}
          favoritedIds={favoritedIds}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          isFetchNextPageError={isFetchNextPageError}
          onFetchNextPage={handleFetchNext}
          onFavoriteToggle={handleToggleFavorite}
          onCardClick={handlePhotoClick}
        />
      ) : selectedLength !== null ? (
        <StyleDetailNoLengthResultsOrganism onClear={clearLength} />
      ) : (
        <StyleDetailEmptyStateOrganism onBackToExplore={handleBackToExplore} />
      )}

      <StyleDetailRelatedRowOrganism
        items={relatedItems}
        onSelect={handleRelatedSelect}
      />
    </div>
  );
}
