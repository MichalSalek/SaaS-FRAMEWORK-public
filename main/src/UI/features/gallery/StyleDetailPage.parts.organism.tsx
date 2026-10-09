// UI/features/gallery/StyleDetailPage.parts.tsx
// Editorial parts for Style Detail (W2.5 iter 1).
// Related styles row, empty/error/not-found/no-length-results states, skeleton.
// The hero lives in StyleDetailHero.tsx (file-size constraint).
// Eyebrow = kanon components/Eyebrow (frozen-light chip, bez kropki).

import { type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowClockwiseIcon,
  CompassRoseIcon,
  ImagesIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import type { TraitCategoryValue } from '@kernel/domain/admin/traits.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { resolveCategoryKey } from './StyleDetailHero.organism';
import styles from './StyleDetailPage.module.css';

/* ─── Related styles row ──────────────────────────────────
 * Spotify "Fans also like" — pills, click → navigate to other style/[id]. */

export interface RelatedStyleItem {
  id: string;
  name: string;
  category: TraitCategoryValue | undefined;
}

interface StyleDetailRelatedRowProps {
  items: readonly RelatedStyleItem[];
  onSelect: (id: string) => void;
}

const RELATED_PALETTE: Record<TraitCategoryValue, string> = {
  technique: 'oklch(0.70 0.13 248)',
  finish: 'oklch(0.74 0.11 312)',
  decoration: 'oklch(0.76 0.13 76)',
  style: 'oklch(0.72 0.13 158)',
};

const FALLBACK_RELATED_HUE = 'oklch(0.72 0.13 28)';

export function StyleDetailRelatedRowOrganism({
  items,
  onSelect,
}: StyleDetailRelatedRowProps) {
  const t = useTranslations('pages.gallery');

  if (items.length === 0) {
    return null;
  }

  return (
    <section
      className={`${styles.relatedSection} ${styles.staggerIn}`}
      style={{ '--stagger-index': 3 } as CSSProperties}
      aria-labelledby='related-styles-title'>
      <header className={styles.relatedHeader}>
        <h2 className={styles.relatedTitle} id='related-styles-title'>
          {t('styleDetailRelatedTitle')}
        </h2>
        <p className={styles.relatedHint}>{t('styleDetailRelatedHint')}</p>
      </header>

      <ul className={styles.relatedChipsRow}>
        {items.map(item => {
          const categoryKey = resolveCategoryKey(item.category);
          const hue =
            item.category !== undefined
              ? RELATED_PALETTE[item.category]
              : FALLBACK_RELATED_HUE;
          return (
            <li key={item.id}>
              <button
                type='button'
                className={styles.relatedChip}
                style={{ ['--chip-hue']: hue } as CSSProperties}
                onClick={() => onSelect(item.id)}>
                <span className={styles.relatedChipDot} aria-hidden='true' />
                <span>{item.name}</span>
                {categoryKey !== null && (
                  <span className={styles.relatedChipCategory}>
                    {t(categoryKey)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ─── State actions helper ──────────────────────────────── */

interface StateActionsProps {
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

function StateActions({
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: StateActionsProps) {
  return (
    <div className={styles.stateActions}>
      <ButtonAtom variant='primary' size='md' onClick={onPrimary}>
        {primaryLabel}
      </ButtonAtom>
      {secondaryLabel !== undefined && onSecondary !== undefined && (
        <ButtonAtom variant='outlined' size='md' onClick={onSecondary}>
          {secondaryLabel}
        </ButtonAtom>
      )}
    </div>
  );
}

/* ─── Empty / not-found / error / no-length-results states ─ */

interface StyleDetailEmptyStateProps {
  onBackToExplore: () => void;
}

export function StyleDetailEmptyStateOrganism({
  onBackToExplore,
}: StyleDetailEmptyStateProps) {
  const t = useTranslations('pages.gallery');
  return (
    <div className={`${styles.stateCard} ${styles.staggerIn}`}>
      <span className={styles.stateIcon} aria-hidden='true'>
        <ImagesIcon size={32} weight='fill' />
      </span>
      <h2 className={styles.stateTitle}>{t('styleDetailEmptyTitle')}</h2>
      <p className={styles.stateHint}>{t('styleDetailEmptyHint')}</p>
      <StateActions
        primaryLabel={t('styleDetailBackToExplore')}
        onPrimary={onBackToExplore}
      />
    </div>
  );
}

interface StyleDetailErrorStateProps {
  onRetry: () => void;
  onBackToExplore: () => void;
}

export function StyleDetailErrorStateOrganism({
  onRetry,
  onBackToExplore,
}: StyleDetailErrorStateProps) {
  const t = useTranslations('pages.gallery');
  return (
    <div className={`${styles.stateCard} ${styles.stateCardError}`}>
      <span
        className={`${styles.stateIcon} ${styles.stateIconError}`}
        aria-hidden='true'>
        <WarningCircleIcon size={32} weight='fill' />
      </span>
      <h2 className={styles.stateTitle}>{t('styleDetailErrorTitle')}</h2>
      <p className={styles.stateHint}>{t('styleDetailErrorHint')}</p>
      <StateActions
        primaryLabel={t('styleDetailRetry')}
        onPrimary={onRetry}
        secondaryLabel={t('styleDetailBackToExplore')}
        onSecondary={onBackToExplore}
      />
    </div>
  );
}

interface StyleDetailNotFoundStateProps {
  onBackToExplore: () => void;
}

export function StyleDetailNotFoundStateOrganism({
  onBackToExplore,
}: StyleDetailNotFoundStateProps) {
  const t = useTranslations('pages.gallery');
  return (
    <div className={`${styles.stateCard} ${styles.staggerIn}`}>
      <span className={styles.stateIcon} aria-hidden='true'>
        <CompassRoseIcon size={32} weight='fill' />
      </span>
      <h2 className={styles.stateTitle}>{t('styleDetailNotFoundTitle')}</h2>
      <p className={styles.stateHint}>{t('styleDetailNotFoundHint')}</p>
      <StateActions
        primaryLabel={t('styleDetailBackToExplore')}
        onPrimary={onBackToExplore}
      />
    </div>
  );
}

interface StyleDetailNoLengthResultsProps {
  onClear: () => void;
}

export function StyleDetailNoLengthResultsOrganism({
  onClear,
}: StyleDetailNoLengthResultsProps) {
  const t = useTranslations('pages.gallery');
  return (
    <div className={`${styles.stateCard} ${styles.staggerIn}`}>
      <span className={styles.stateIcon} aria-hidden='true'>
        <ArrowClockwiseIcon size={28} weight='fill' />
      </span>
      <h2 className={styles.stateTitle}>
        {t('styleDetailNoLengthResultsTitle')}
      </h2>
      <p className={styles.stateHint}>{t('styleDetailNoLengthResultsHint')}</p>
      <StateActions
        primaryLabel={t('styleDetailClearLengthFilter')}
        onPrimary={onClear}
      />
    </div>
  );
}

/* ─── Skeleton ─────────────────────────────────────────── */

export function StyleDetailSkeletonMolecule() {
  return (
    <>
      <div className={styles.skeletonHero} aria-hidden='true'>
        <div className={styles.skeletonHeroContent}>
          <div className={`${styles.skeletonLine} ${styles.skeletonEyebrow}`} />
          <div className={`${styles.skeletonLine} ${styles.skeletonTitle}`} />
          <div className={styles.skeletonStats}>
            <div
              className={`${styles.skeletonLine} ${styles.skeletonStatPill}`}
            />
            <div
              className={`${styles.skeletonLine} ${styles.skeletonStatPill}`}
            />
            <div
              className={`${styles.skeletonLine} ${styles.skeletonStatPill}`}
            />
          </div>
        </div>
      </div>

      <div className={styles.skeletonFilters} aria-hidden='true'>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={`${styles.skeletonLine} ${styles.skeletonFilterChip}`}
          />
        ))}
      </div>

      <div className={styles.skeletonMasonry} aria-hidden='true'>
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className={`${styles.skeletonLine} ${styles.skeletonCard}`}
          />
        ))}
      </div>
    </>
  );
}
