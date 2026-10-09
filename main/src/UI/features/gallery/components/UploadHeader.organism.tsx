// UI/features/gallery/components/UploadHeader.organism.tsx
// Plan-limit gate + photo preview card. The wizard's header (title and step
// indicator) is UploadProcessHeader.organism.
// Extracted from UploadAssetPage.parts to respect the 300 LOC ceiling.

import { LockIcon, TrendUpIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import Image from 'next/image';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import styles from '../UploadAssetPage.module.css';

/* ============================================================
 *  PLAN LIMIT GATE — pre-wizard block when cap is hit
 *  Elegant lock state with upgrade CTA. Honest UX > misleading banner.
 * ============================================================ */

interface UploadPlanLimitGateProps {
  currentPlan: PricingPlan;
  photoCount: number;
  maxPhotos: number;
  onUpgrade: () => void;
  onBackToGallery: () => void;
}

export function UploadPlanLimitGateOrganism({
  currentPlan,
  photoCount,
  maxPhotos,
  onUpgrade,
  onBackToGallery,
}: UploadPlanLimitGateProps) {
  const t = useTranslations('pages.gallery');
  return (
    <div className={styles.planGate}>
      <div className={styles.planGateInner}>
        <div className={styles.planGateIconHalo} aria-hidden='true'>
          <LockIcon size={32} weight='duotone' />
        </div>
        <TypographyAtom
          variant='h2'
          align='center'
          className={styles.planGateTitle}>
          {t('uploadPlanReachedTitle')}
        </TypographyAtom>
        <TypographyAtom
          variant='body1'
          align='center'
          className={styles.planGateBody}>
          {t('uploadPlanReachedBody', {
            plan: getPlanDisplayName(currentPlan),
            max: maxPhotos,
            count: photoCount,
          })}
        </TypographyAtom>
        <div className={styles.planGateActions}>
          <ButtonAtom
            variant='primary'
            size='lg'
            icon={<TrendUpIcon size={18} weight='fill' />}
            onClick={onUpgrade}
            className={styles.planGateCta}>
            {t('uploadPlanReachedCta')}
          </ButtonAtom>
          {/* outlined, nie ghost — patrz UploadSuccessScreen: drugorzędne wyjście
              musi wyglądać na przycisk, jedno wypełnione CTA trzyma upgrade. */}
          <ButtonAtom variant='outlined' size='md' onClick={onBackToGallery}>
            {t('uploadPlanReachedKeep')}
          </ButtonAtom>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 *  PHOTO PREVIEW CARD — stays above tag/summary form
 *  Branded badge (top-left) + change-photo affordance (top-right).
 * ============================================================ */

interface PhotoPreviewCardProps {
  src: string;
  /**
   * `'review'` = the framed photo itself is what the step shows (crop review).
   * `'compact'` = a thumbnail reminder above the tag and summary forms.
   */
  size?: 'review' | 'compact';
}

/**
 * DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
 * zmiana zdjęcia żyje WYŁĄCZNIE na kroku kadrowania (`[Zmień] [Zatwierdź →]`).
 * Ta karta miała własną pigułkę „Zmień zdjęcie” na trzech ekranach z rzędu,
 * czyli tę samą poboczną akcję powtórzoną obok głównej ścieżki. Z kroków 2 i 3
 * do wymiany zdjęcia prowadzi „Wstecz”.
 */
export function PhotoPreviewCardOrganism({
  src,
  size = 'review',
}: PhotoPreviewCardProps) {
  const t = useTranslations('pages.gallery');
  if (size === 'compact') {
    return (
      <div className={styles.previewCompact}>
        <Image
          src={src}
          alt={t('uploadPreviewAlt')}
          width={64}
          height={85}
          className={styles.previewCompactImage}
          unoptimized
        />
        <div className={styles.previewCompactText}>
          <p className={styles.previewCompactTitle}>
            {t('uploadPreviewBadge')}
          </p>
          <p className={styles.previewCompactHint}>{t('uploadPreviewHint')}</p>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`${styles.previewCard} ${styles.staggerIn}`}
      style={{ '--stagger-index': 3 } as React.CSSProperties}>
      <div className={styles.previewImageFrame}>
        <Image
          src={src}
          alt={t('uploadPreviewAlt')}
          width={400}
          height={533}
          className={styles.previewImage}
          unoptimized
        />
        <span className={styles.previewBadge}>{t('uploadPreviewBadge')}</span>
      </div>
    </div>
  );
}
