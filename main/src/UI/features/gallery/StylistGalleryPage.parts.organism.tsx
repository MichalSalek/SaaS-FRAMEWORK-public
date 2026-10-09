// UI/features/gallery/StylistGalleryPage.parts.organism.tsx
// Editorial parts for the Stylist Gallery. Action panel, empty / no-results /
// error / skeleton states. The cover hero lives in
// StylistExhibitHero.organism.tsx (file-size constraint).
// Shares the stylesheet StylistGalleryPage.module.css: white boxes on paper,
// no frames, ZERO shadow / glow / gradient (anti-slop floor).

import { useTranslations } from 'next-intl';
import { ImagesIcon, LinkSimpleIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import styles from './StylistGalleryPage.module.css';

/* ============================================================
 * StylistActionPanel — Stripe success-tier prominent action.
 * "Sparuj się" (unpaired-only). Wariant paired USUNIĘTY (census S26):
 * status parowania komunikuje badge „Sparowano" na hero — druga zielona
 * karta dublowała status; rodzic nie renderuje panelu gdy paired.
 * ============================================================ */

interface StylistActionPanelProps {
  isLoggedInClient: boolean;
  onPair: () => void;
}

export function StylistActionPanelOrganism({
  isLoggedInClient,
  onPair,
}: StylistActionPanelProps) {
  const t = useTranslations('pages.gallery');

  return (
    <section className={styles.actionPanel}>
      <span className={styles.actionPanelIcon} aria-hidden='true'>
        <LinkSimpleIcon size={20} />
      </span>
      <div className={styles.actionPanelText}>
        <p className={styles.actionPanelTitle}>
          {isLoggedInClient
            ? t('stylistActionUnpairedTitle')
            : t('stylistActionGuestTitle')}
        </p>
        <p className={styles.actionPanelHint}>
          {isLoggedInClient
            ? t('stylistActionUnpairedHint')
            : t('stylistActionGuestHint')}
        </p>
      </div>
      <ButtonAtom
        variant='primary'
        size='md'
        className={styles.actionPanelCta}
        onClick={onPair}>
        {t('stylistActionUnpairedCta')}
      </ButtonAtom>
    </section>
  );
}

/* ============================================================
 * StylistEmptyState — branded "no photos yet" panel.
 * ============================================================ */

export function StylistEmptyStateOrganism() {
  const t = useTranslations('pages.gallery');
  const lang = useCurrentLang();
  return (
    <EmptyStateAtom
      className={styles.emptyState}
      icon={<ImagesIcon size={32} weight='duotone' />}
      title={t('stylistEmptyTitle')}
      titleAs='h2'
      description={t('stylistEmptyHint')}
      lang={lang}
    />
  );
}

/* ============================================================
 * StylistNoFilterResults — empty after filtering.
 * ============================================================ */

interface StylistNoFilterResultsProps {
  onClear: () => void;
}

export function StylistNoFilterResultsOrganism({
  onClear,
}: StylistNoFilterResultsProps) {
  const t = useTranslations('pages.gallery');
  const lang = useCurrentLang();
  return (
    <EmptyStateAtom
      className={styles.emptyState}
      icon={<ImagesIcon size={32} weight='duotone' />}
      title={t('noResults')}
      titleAs='h2'
      description={t('filtersChangeHint')}
      lang={lang}
      action={
        <ButtonAtom variant='outlined' size='sm' onClick={onClear}>
          {t('clearFilters')}
        </ButtonAtom>
      }
    />
  );
}

/* ============================================================
 * StylistErrorState — the shared error state with retry, plus a way back.
 * ============================================================ */

interface StylistErrorStateProps {
  /** Re-runs the gallery query (was wired to „back" under a retry icon). */
  onRetry: () => void;
  /** The retry is in flight: the button turns busy instead of looking dead. */
  isRetrying: boolean;
  onBack: () => void;
}

export function StylistErrorStateOrganism({
  onRetry,
  isRetrying,
  onBack,
}: StylistErrorStateProps) {
  const t = useTranslations('pages.gallery');
  return (
    <div className={styles.errorState}>
      <ErrorStateMolecule
        message={t('loadError')}
        retryLabel={t('retry')}
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
      <ButtonAtom variant='outlined' size='sm' onClick={onBack}>
        {t('goBack')}
      </ButtonAtom>
    </div>
  );
}

/* ============================================================
 * StylistExhibitHeroSkeleton — shimmer skeleton matching layout.
 * ============================================================ */

export function StylistExhibitHeroSkeletonMolecule() {
  return (
    <section className={styles.skeletonHero}>
      <div className={styles.skeletonCover} />
      <div className={styles.skeletonBody}>
        <div className={styles.skeletonAvatar} />
        <div className={`${styles.skeletonLine} ${styles.skeletonLineLg}`} />
        <div className={`${styles.skeletonLine} ${styles.skeletonLineSm}`} />
      </div>
    </section>
  );
}

/* ============================================================
 * StylistGallerySkeletonGrid — full-width card skeleton list.
 * ============================================================ */

export function StylistGallerySkeletonGridMolecule() {
  return (
    <div className={styles.skeletonGrid}>
      {Array.from({ length: 4 }, (_, i) => (
        <SkeletonAtom key={i} variant='rect' className={styles.skeletonCard} />
      ))}
    </div>
  );
}

/* ============================================================
 * SessionPickBanner — top banner shown when in ?addToSession mode
 * ============================================================ */

export function SessionPickBannerAtom() {
  const t = useTranslations('pages.gallery');
  return (
    <div className={styles.sessionPickBanner}>
      <span>{t('sessionPickBannerText')}</span>
    </div>
  );
}
