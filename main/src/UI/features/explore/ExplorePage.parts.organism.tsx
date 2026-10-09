// UI/features/explore/ExplorePage.parts.tsx
// Editorial parts for the Explore (Styles) feed — branded empty/error
// states, masonry skeleton, filter chips. Karta-intro = kanon <AppHero>
// (S25/1 wariant D), renderowana bezpośrednio w ExplorePage.tsx.
// Inherits the curated portfolio vibe (brand-tinted solid tonal surfaces,
// spring easing, sparkle SVG mask). Also exports shared types.

/* ============================================================
 * ExploreTab — shared tab identifier type
 * ============================================================ */

export type ExploreTab = 'styles' | 'stylists';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { ChipAtom, ChipGroupMolecule } from '../../components/Chip/Chip.atom';
import { useNailLengthOptions } from '../shared/gallery/nailLengthOptions.config';
import { useGalleryColors } from '../shared/gallery/hooks/useGalleryColors';
import { useGalleryTraits } from '../shared/gallery/hooks/useGalleryTraits';
import {
  ArrowClockwiseIcon,
  CompassIcon,
  MagnifyingGlassIcon,
  QrCodeIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import styles from './ExplorePage.module.css';

/* ============================================================
 * ExploreSkeletonMasonry — varied-height card placeholders to hint
 * at the masonry rhythm of the real feed (3-4 column layout).
 * ============================================================ */

const SKELETON_RATIOS = [
  { aspect: 3 / 4 },
  { aspect: 1 / 1 },
  { aspect: 4 / 5 },
  { aspect: 2 / 3 },
  { aspect: 3 / 4 },
  { aspect: 4 / 5 },
  { aspect: 1 / 1 },
  { aspect: 3 / 4 },
] as const;

export function ExploreSkeletonMasonryMolecule() {
  return (
    <div
      className={styles.skeletonMasonry}
      role='status'
      aria-busy='true'
      aria-live='polite'>
      {SKELETON_RATIOS.map((r, i) => (
        <div
          key={i}
          className={styles.skeletonMasonryCard}
          aria-hidden='true'
          style={{
            aspectRatio: `${r.aspect}`,
            animationDelay: `${(i % 4) * 80}ms`,
          }}
        />
      ))}
    </div>
  );
}

/* ============================================================
 * ExploreEditorialEmpty — branded illustration + actionable tips
 * Replaces the bare "MagnifyingGlass + text" empty state with a
 * Notion-style onboarding card. Three tip chips + clear-filters CTA.
 * ============================================================ */

interface ExploreEditorialEmptyProps {
  onClearFilters: () => void;
  hasFiltersActive: boolean;
}

export function ExploreEditorialEmptyOrganism({
  onClearFilters,
  hasFiltersActive,
}: ExploreEditorialEmptyProps) {
  const t = useTranslations('pages.explore');
  return (
    <EmptyStateAtom
      size='page'
      className={`${styles.editorialEmpty} ${styles.staggerIn}`}
      style={{ '--stagger-index': 2 } as React.CSSProperties}
      icon={<CompassIcon size={44} weight='duotone' />}
      title={t('emptyTitle')}
      titleAs='h2'
      description={t('stylesEmptyHintExtended')}
      {...(hasFiltersActive
        ? {
            action: (
              <ButtonAtom
                variant='primary'
                size='lg'
                icon={<MagnifyingGlassIcon size={18} />}
                onClick={onClearFilters}>
                {t('stylesEmptyTipFilter')}
              </ButtonAtom>
            ),
          }
        : {})}>
      <div className={styles.editorialEmptyTips}>
        <span className={styles.editorialEmptyTipChip}>
          <MagnifyingGlassIcon
            size={12}
            weight='fill'
            className={styles.editorialEmptyTipChipIcon}
          />
          {t('stylesEmptyTipFresh')}
        </span>
        <span className={styles.editorialEmptyTipChip}>
          <QrCodeIcon
            size={12}
            weight='fill'
            className={styles.editorialEmptyTipChipIcon}
          />
          {t('stylesEmptyTipPaired')}
        </span>
      </div>
    </EmptyStateAtom>
  );
}

/* ============================================================
 * ExploreEditorialError — branded error card, not a generic
 * warning circle. Mirrors empty-state styling but warn-tinted.
 * ============================================================ */

interface ExploreEditorialErrorProps {
  onRetry: () => void;
  isFetching: boolean;
  /** Override title/hint for reuse across tabs; defaults to the Styles copy. */
  title?: string;
  hint?: string;
}

export function ExploreEditorialErrorOrganism({
  onRetry,
  isFetching,
  title,
  hint,
}: ExploreEditorialErrorProps) {
  const t = useTranslations('pages.explore');
  return (
    <div className={styles.editorialError}>
      <div className={styles.editorialErrorIcon}>
        <WarningCircleIcon size={32} weight='duotone' />
      </div>
      <h2 className={styles.editorialErrorTitle}>
        {title ?? t('stylesErrorTitle')}
      </h2>
      <p className={styles.editorialErrorHint}>
        {hint ?? t('stylesErrorHint')}
      </p>
      <ButtonAtom
        variant='outlined'
        size='md'
        icon={<ArrowClockwiseIcon size={16} />}
        onClick={onRetry}
        disabled={isFetching}
        className='haptic-press'>
        {t('retry')}
      </ButtonAtom>
    </div>
  );
}

/* ============================================================
 * ExploreEndOfFeed — closing note at end of infinite scroll.
 * Reassuring rather than abrupt (matches "kuratorska kolekcja"
 * narrative — feed has a graceful close, not a sudden stop).
 * ============================================================ */

export function ExploreEndOfFeedMolecule() {
  const t = useTranslations('pages.explore');
  return (
    <div className={styles.endOfFeed}>
      <p className={styles.endOfFeedText}>{t('stylesEndOfFeed')}</p>
    </div>
  );
}

/* ============================================================
 * ExploreActiveFilterChips — deletable chip row for active filters.
 * Rendered only when totalActiveFilters > 0.
 * ============================================================ */

interface ExploreActiveFilterChipsProps {
  colorIds: string[];
  traitIds: string[];
  selectedLength: NailLength | null;
  onToggleColor: (id: string) => void;
  onToggleTrait: (id: string) => void;
  onToggleLength: (id: NailLength) => void;
}

export function ExploreActiveFilterChipsMolecule({
  colorIds,
  traitIds,
  selectedLength,
  onToggleColor,
  onToggleTrait,
  onToggleLength,
}: ExploreActiveFilterChipsProps) {
  const nailLengthOptions = useNailLengthOptions();
  // colorIds/traitIds hold cuid IDs — resolve to display names for the chip
  // label. Both queries are already cached (5 min staleTime, fetched by the
  // page), so this adds no extra network cost.
  const { colors } = useGalleryColors();
  const { traits } = useGalleryTraits();

  // DECISION (nie usuwaj tego komentarza) — 2026-09-09:
  // Nierozwiązane id NIE renderuje się już jako etykieta. Wcześniej było
  // `?? c`, czyli przy nietrafionym odczycie użytkowniczka dostawała chip
  // z surowym cuidem („cmrqejp0i00gf59qogca5x5yl") jako nazwą filtra. Trafia
  // się to w dwóch sytuacjach: zimny cache (przejściowa) i skasowany wiersz
  // taksonomii (trwała — filtr wskazuje coś, czego już nie ma). W obu
  // wypadkach id jest bezużyteczne jako tekst dla człowieka, więc chip po
  // prostu nie powstaje.
  //
  // Mapa zamiast `find()` w pętli: `find` wewnątrz `map` to iloczyn dwóch
  // kolekcji przy każdym renderze; mapa buduje się raz na zmianę taksonomii
  // i odczyt jest stały.
  const colorNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (let i = 0; i < colors.length; i++) {
      byId.set(colors[i].id, colors[i].name);
    }
    return byId;
  }, [colors]);
  const traitNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (let i = 0; i < traits.length; i++) {
      byId.set(traits[i].id, traits[i].name);
    }
    return byId;
  }, [traits]);

  return (
    <div className={styles.activeFilters}>
      <ChipGroupMolecule>
        {colorIds.map(c => {
          const label = colorNameById.get(c);
          return label == null ? null : (
            <ChipAtom
              key={`c-${c}`}
              label={label}
              size='sm'
              className={styles.activeChip}
              onDelete={() => onToggleColor(c)}
            />
          );
        })}
        {traitIds.map(tt => {
          const label = traitNameById.get(tt);
          return label == null ? null : (
            <ChipAtom
              key={`t-${tt}`}
              label={label}
              size='sm'
              className={styles.activeChip}
              onDelete={() => onToggleTrait(tt)}
            />
          );
        })}
        {selectedLength && (
          <ChipAtom
            label={
              nailLengthOptions.find(l => l.id === selectedLength)?.label ??
              selectedLength
            }
            size='sm'
            className={styles.activeChip}
            onDelete={() => onToggleLength(selectedLength)}
          />
        )}
      </ChipGroupMolecule>
    </div>
  );
}
