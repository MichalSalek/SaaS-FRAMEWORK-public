// UI/features/gallery/StylistGalleryPage.parts.organism.tsx
// Editorial parts for the Stylist Gallery. Action panel, empty / no-results /
// error / skeleton states. The cover hero lives in
// StylistExhibitHero.organism.tsx (file-size constraint).
// Shares the stylesheet StylistGalleryPage.module.css: white boxes on paper,
// no frames, ZERO shadow / glow / gradient (anti-slop floor).

import { useTranslations } from 'next-intl';
import { ImagesIcon, LinkSimpleIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { withPairIntent } from '../shared/pairing/pair-intent';
import type { PairingAudience } from '../shared/pairing/pairingAudience';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import styles from './StylistGalleryPage.module.css';

/* ============================================================
 * StylistActionPanel — audience-specific connection entry or pending status.
 * Paired viewers can return to the stylist's profile from the gallery.
 * ============================================================ */

export function StylistActionPanelOrganism({
  audience,
  stylistId,
}: {
  audience: PairingAudience;
  stylistId: string;
}) {
  const t = useTranslations('pages.gallery');
  const tExplainer = useTranslations('stylist.pairingExplainer');
  const tActions = useTranslations('stylist.actions');
  if (audience === 'clientPaired') {
    return (
      <LinkButtonAtom
        href={buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
          identifier: stylistId,
        })}
        variant='outlined'
        size='md'>
        {t('stylistActionProfileCta')}
      </LinkButtonAtom>
    );
  }
  const presentations: Record<
    PairingAudience,
    {
      title: string;
      hint: string;
      requestIntent: boolean;
      status?: boolean;
    } | null
  > = {
    checking: null,
    accessFailed: null,
    owner: null,
    clientPaired: null,
    guest: {
      title: t('stylistActionGuestTitle'),
      hint: t('stylistActionGuestHint'),
      requestIntent: true,
    },
    clientOnboarding: {
      title: t('stylistActionUnpairedTitle'),
      hint: tExplainer('howClientOnboarding'),
      requestIntent: true,
    },
    clientPublic: {
      title: t('stylistActionUnpairedTitle'),
      hint: t('stylistActionUnpairedHint'),
      requestIntent: true,
    },
    clientPending: {
      title: tActions('requestPending'),
      hint: tExplainer('howPending'),
      requestIntent: false,
      status: true,
    },
    stylistWithClient: {
      title: tExplainer('afterItems.fullGallery'),
      hint: tExplainer('howOtherStylistWithClient'),
      requestIntent: false,
    },
    stylistNoClient: {
      title: tExplainer('afterItems.fullGallery'),
      hint: tExplainer('howOtherStylistNoClient'),
      requestIntent: false,
    },
  };
  const presentation = presentations[audience];
  if (!presentation) {
    return null;
  }
  const profileHref = buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
    identifier: stylistId,
  });
  const href = presentation.requestIntent
    ? withPairIntent(profileHref)
    : profileHref;
  return (
    <section className={styles.actionPanel}>
      <span className={styles.actionPanelIcon} aria-hidden='true'>
        <LinkSimpleIcon size={20} />
      </span>
      <div className={styles.actionPanelText}>
        <p
          className={styles.actionPanelTitle}
          role={presentation.status ? 'status' : undefined}>
          {presentation.title}
        </p>
        <p className={styles.actionPanelHint}>{presentation.hint}</p>
      </div>
      <LinkButtonAtom
        variant='primary'
        size='md'
        className={styles.actionPanelCta}
        href={href}>
        {t(
          presentation.requestIntent
            ? 'stylistActionUnpairedCta'
            : 'stylistActionProfileCta'
        )}
      </LinkButtonAtom>
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

export function SessionPickBannerAtom({
  isShared = false,
}: {
  /** The stylist already has the session: say that she sees changes at once
   *  (a reader could not tell whether a tap on a photo reaches her). */
  isShared?: boolean;
}) {
  const t = useTranslations('pages.gallery');
  return (
    <p className={styles.sessionPickBanner}>
      {t('sessionPickBannerText')}
      {isShared && ` ${t('sessionPick.bannerShared')}`}
    </p>
  );
}
