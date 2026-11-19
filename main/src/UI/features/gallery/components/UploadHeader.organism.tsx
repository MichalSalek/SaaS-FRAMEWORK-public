// UI/features/gallery/components/UploadHeader.organism.tsx
// Plan-limit gate + photo preview card. The wizard's header (title and step
// indicator) is UploadProcessHeader.organism.
// Extracted from UploadAssetPage.parts to respect the 300 LOC ceiling.

import { useState } from 'react';
import { LockIcon, TrendUpIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import Image from 'next/image';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { UploadPhotoPreviewOrganism } from './UploadPhotoPreview.organism';
import previewStyles from './UploadPhotoPreview.module.css';
import styles from '../UploadAssetPage.module.css';
import { useQuotaTranslations } from '../../shared/upsell/quotaTranslations';
import { buildPlanPayDeepLink } from '../../shared/pricing/pricingFunnelHref';
import {
  getLowestEligibleUpgradePlan,
  getQuotaUpgradeRoute,
} from '../../../../application/pricing/quota.helpers';
import { bypassLeaveGuard } from '../../../../application/routing/leave-guard';
import { usePurchaseResumeCapture } from '../../shared/upsell/usePurchaseResumeCapture';

/* ============================================================
 *  PLAN LIMIT GATE — pre-wizard block when cap is hit
 *  Elegant lock state with upgrade CTA. Honest UX > misleading banner.
 * ============================================================ */

interface UploadPlanLimitGateProps {
  currentPlan: PricingPlan;
  onBackToGallery: () => void;
}

export function UploadPlanLimitGateOrganism({
  currentPlan,
  onBackToGallery,
}: UploadPlanLimitGateProps) {
  const t = useTranslations('pages.gallery');
  const tq = useQuotaTranslations();
  const captureResume = usePurchaseResumeCapture();
  const targetPlan = getLowestEligibleUpgradePlan('gallery', currentPlan);
  const destination = targetPlan ? getQuotaUpgradeRoute(targetPlan) : null;
  const upgradeHref =
    destination?.kind === 'contact'
      ? destination.href
      : destination
        ? buildPlanPayDeepLink(destination.planId, 'month')
        : null;
  return (
    <>
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
            })}
          </TypographyAtom>
          <div className={styles.planGateActions}>
            {upgradeHref && targetPlan && (
              <LinkButtonAtom
                href={upgradeHref}
                variant='primary'
                size='lg'
                icon={<TrendUpIcon size={18} weight='fill' />}
                onClick={() => {
                  if (destination?.kind !== 'contact') {
                    captureResume({ kind: 'upload' });
                  }
                  bypassLeaveGuard();
                }}
                className={styles.planGateCta}>
                {tq(
                  destination?.kind === 'contact'
                    ? 'components.quotaUpgrade.contact'
                    : 'components.quotaUpgrade.upgrade',
                  { plan: getPlanDisplayName(targetPlan) }
                )}
              </LinkButtonAtom>
            )}
            <ButtonAtom variant='outlined' size='md' onClick={onBackToGallery}>
              {t('uploadPlanReachedKeep')}
            </ButtonAtom>
          </div>
        </div>
      </div>
    </>
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
 * DECISION: changing the photo lives ONLY on the crop step (`[Zmień] [Zatwierdź]`). This card had
 * its own "Zmień zdjęcie" pill on three screens in a row, the same side action repeated next to the
 * main path. From steps 2 and 3, "Wstecz" leads to swapping the photo. (owner)
 */
export function PhotoPreviewCardOrganism({
  src,
  size = 'review',
}: PhotoPreviewCardProps) {
  const t = useTranslations('pages.gallery');
  const [previewOpen, setPreviewOpen] = useState(false);
  if (size === 'compact') {
    return (
      <>
        <ButtonAtom
          variant='text'
          className={`${styles.previewCompact} ${previewStyles.trigger}`}
          aria-haspopup='dialog'
          ariaLabel={`${t('uploadPreviewBadge')}. ${t('uploadPreviewHint')}`}
          onClick={() => setPreviewOpen(true)}>
          <span className={previewStyles.triggerContent}>
            <Image
              src={src}
              alt=''
              width={64}
              height={85}
              className={styles.previewCompactImage}
              unoptimized
            />
            <span className={styles.previewCompactText}>
              <span className={styles.previewCompactTitle}>
                {t('uploadPreviewBadge')}
              </span>
              <span className={styles.previewCompactHint}>
                {t('uploadPreviewHint')}
              </span>
            </span>
          </span>
        </ButtonAtom>
        <UploadPhotoPreviewOrganism
          src={src}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
        />
      </>
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
