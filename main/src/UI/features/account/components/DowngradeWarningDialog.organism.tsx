// UI/features/account/components/DowngradeWarningDialog.tsx
// DECISION: loss aversion: the dialog shows CONCRETE NUMBERS before a downgrade (retention by
// making the real loss visible). Default focus is on CANCEL (opting in to the downgrade, easy
// opt-out). The header Back is the same keep-plan action: focus it so the
// fullscreen view starts at its title. Render ONLY when currentPlan !== FREE.
//
// TWO VARIANTS, because selectPlan opens this dialog for EVERY downgrade:
//  • target FREE → cancelling the subscription in the Stripe portal; losses = Free limits
//                (gallery, clients, watermark).
//  • target PAID (Scale→Studio, Pro Marka→Pro) → immediate plan change with proration
//                (usePlanChange); losses = the entitlements the target really removes (brand
//                color, pins, team, history).
// Both used to get the copy "go back to Free / cancel the subscription" and then a paid target
// went to plan-change, so the dialog lied about what would happen to the money.

import { useEffect, useId, type ReactNode } from 'react';
import { capturePosthog } from '../../../../application/analytics/posthog-client';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import {
  PricingPlanValue,
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { PlanDecisionSurfaceOrganism } from '../../shared/pricing/PlanDecisionSurface.organism';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
import styles from './DowngradeWarningDialog.module.css';
import {
  resolveFreeDowngradeLosses,
  type DowngradeWarningStats,
} from './downgradeWarning.helpers';

export type { DowngradeWarningStats };

export interface DowngradeWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** null = counts unknown (loading or failed): generic copy, never a wrong number. */
  stats: DowngradeWarningStats | null;
  currentPlan: PricingPlan;
  targetPlan: PricingPlan;
  paymentDetails?: ReactNode;
  confirmDisabled?: boolean;
  busy?: boolean;
}

const FREE_GALLERY_LIMIT = PRICING_POLICY.LIMITS.FREE.max_gallery_records;
const FREE_CLIENTS_LIMIT = PRICING_POLICY.LIMITS.FREE.max_paired_clients;

export function DowngradeWarningDialogOrganism({
  isOpen,
  onClose,
  onConfirm,
  stats,
  currentPlan,
  targetPlan,
  paymentDetails,
  confirmDisabled = false,
  busy = false,
}: DowngradeWarningDialogProps) {
  const t = useTranslations('account.pay.downgradeWarning');

  const titleId = useId();

  // Churn-funnel event (pattern of upgrade_prompt_shown): showing the warning
  // before a downgrade is a measurable retention chance. Pair: downgrade_confirmed
  // (useAccountPayActions); shown without confirmed = a save. An effect, not a
  // mount capture, because the component stays mounted (isOpen toggles a null
  // render). The condition mirrors the early return below. The singleton
  // honors opt-out internally.
  useEffect(() => {
    if (isOpen && currentPlan !== PricingPlanValue.FREE) {
      capturePosthog('downgrade_warning_shown', {
        current_plan: currentPlan,
        target_plan: targetPlan,
      });
    }
  }, [isOpen, currentPlan, targetPlan]);

  // Render nothing if already on FREE (no warning needed) or dialog not open
  // Note: hooks above are still called unconditionally (React rules)
  if (currentPlan === PricingPlanValue.FREE || !isOpen) {
    return null;
  }

  const isToFree = targetPlan === PricingPlanValue.FREE;
  const targetName = getPlanDisplayName(targetPlan);
  const currentLimits = PRICING_POLICY.LIMITS[currentPlan];
  const targetLimits = PRICING_POLICY.LIMITS[targetPlan];

  // Split-key approach: bold label + plain suffix rendered as JSX
  // Avoids dangerouslySetInnerHTML and t.rich() complexity.
  // The count-based lines (gallery / clients) are shown ONLY when the stylist
  // actually HAS that content — a "0 zdjęć zostanie zachowane…" line reads as
  // confusing noise (nothing to lose). The plan-feature losses (stats,
  // unlimited) are always relevant to a downgrade.
  const paidLossItems: { key: string; content: ReactNode }[] = [
    ...(currentLimits.can_brand_profile && !targetLimits.can_brand_profile
      ? [
          {
            key: 'branding',
            content: (
              <>
                <strong>{t('lossBrandingLabel')}</strong>: {t('lossBranding')}
              </>
            ),
          },
        ]
      : []),
    ...(targetLimits.max_pinned_records < currentLimits.max_pinned_records
      ? [
          {
            key: 'pinned',
            content: (
              <>
                <strong>{t('lossPinnedLabel')}</strong>:{' '}
                {t('lossPinned', {
                  current: currentLimits.max_pinned_records,
                  target: targetLimits.max_pinned_records,
                })}
              </>
            ),
          },
        ]
      : []),
    ...(currentLimits.can_use_staff_accounts &&
    !targetLimits.can_use_staff_accounts
      ? [
          {
            key: 'staff',
            content: (
              <>
                <strong>{t('lossStaffLabel')}</strong>: {t('lossStaff')}
              </>
            ),
          },
        ]
      : []),
    ...(isUnlimitedLimit(currentLimits.history_retention_days) &&
    !isUnlimitedLimit(targetLimits.history_retention_days)
      ? [
          {
            key: 'history',
            content: (
              <>
                <strong>{t('lossHistoryLabel')}</strong>:{' '}
                {t('lossHistory', {
                  days: targetLimits.history_retention_days,
                })}
              </>
            ),
          },
        ]
      : []),
  ];

  // Count lines come from resolveFreeDowngradeLosses (pure, tested): exact
  // numbers when the usage counts are known, generic limit lines otherwise.
  const freeLossItems: { key: string; content: ReactNode }[] =
    resolveFreeDowngradeLosses(stats).map(loss => {
      switch (loss.kind) {
        case 'gallery':
          return {
            key: loss.kind,
            content: (
              <>
                <strong>{t('lossGalleryCount', { count: loss.count })}</strong>:{' '}
                {loss.remaining > 0
                  ? t('lossGalleryRoom', { remaining: loss.remaining })
                  : t('lossGalleryFull', { limit: loss.limit })}
              </>
            ),
          };
        case 'clients':
          return {
            key: loss.kind,
            content: (
              <>
                <strong>{t('lossClientsCount', { count: loss.count })}</strong>:{' '}
                {loss.remaining > 0
                  ? t('lossClientsRoom', { remaining: loss.remaining })
                  : t('lossClientsFull', { limit: loss.limit })}
              </>
            ),
          };
        case 'pinned':
          return {
            key: loss.kind,
            content: (
              <>
                <strong>{t('lossPinnedCount', { count: loss.count })}</strong>:{' '}
                {t('lossPinnedFree', { limit: loss.limit })}
              </>
            ),
          };
        case 'watermark':
          return {
            key: loss.kind,
            content: (
              <>
                <strong>{t('lossStatsLabel')}</strong>: {t('lossStats')}
              </>
            ),
          };
        case 'galleryLimit':
          return {
            key: loss.kind,
            content: (
              <>
                <strong>{t('lossUnlimitedLabel')}</strong>:{' '}
                {t('lossUnlimited', { limit: loss.limit })}
              </>
            ),
          };
      }
    });

  const lossItems = isToFree ? freeLossItems : paidLossItems;

  return (
    <PlanDecisionSurfaceOrganism
      backLabel={t('cancelCta')}
      title={isToFree ? t('title') : t('paidTitle', { name: targetName })}
      titleId={titleId}
      role='alertdialog'
      initialFocus='first'
      dismissLocked={busy}
      onClose={onClose}>
      {close => (
        <>
          <p className={styles.subtitle}>
            {isToFree ? t('subtitle') : t('paidSubtitle', { name: targetName })}
          </p>

          {/* Loss list */}
          {lossItems.length > 0 && (
            <ul
              className={styles.lossList}
              aria-label={
                isToFree
                  ? t('lossListLabel')
                  : t('lossListLabelPaid', { name: targetName })
              }>
              {lossItems.map(item => (
                <li key={item.key} className={styles.lossItem}>
                  <span className={styles.lossBullet} aria-hidden='true'>
                    &#x26A0;&#xFE0E;
                  </span>
                  <span className={styles.lossText}>{item.content}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Reminder: FREE limits, or how a paid→paid change settles */}
          <p className={styles.freeReminder}>
            {isToFree
              ? t('freeLimitsReminder', {
                  gallery: FREE_GALLERY_LIMIT,
                  clients: FREE_CLIENTS_LIMIT,
                })
              : t('paidChangeReminder', { name: targetName })}
          </p>

          {paymentDetails}
          {/* Cancel stays primary; the matching header action receives initial focus. */}
          <div className={styles.actions}>
            <span className={styles.cancelWrap}>
              <ButtonAtom
                variant='primary'
                size='lg'
                className={clsx(styles.btn, styles.btnCancel)}
                disabled={busy}
                onClick={close}>
                {t('cancelCta')}
              </ButtonAtom>
            </span>
            <ButtonAtom
              variant='ghost'
              size='md'
              className={clsx(styles.btn, styles.btnConfirm)}
              disabled={confirmDisabled || busy}
              loading={busy}
              onClick={onConfirm}>
              {isToFree
                ? t('confirmCta')
                : t('paidConfirmCta', { name: targetName })}
            </ButtonAtom>
          </div>
        </>
      )}
    </PlanDecisionSurfaceOrganism>
  );
}
