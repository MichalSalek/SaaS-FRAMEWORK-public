// UI/features/account/components/DowngradeWarningDialog.tsx
// DECISION (nie usuwaj tego komentarza):
// N10 Loss Aversion: pokazuje KONKRETNE LICZBY przed downgrade'em
// — conversion retention przez unaocznienie realnej straty.
// Default focus na CANCEL (loss aversion: opt-in do downgrade, easy opt-out).
// Renderować TYLKO gdy currentPlan !== FREE.
// Button nie forward'uje ref — fokus przez cancelWrapRef + querySelector.
//
// DWA WARIANTY, bo selectPlan otwiera ten dialog dla KAŻDEGO downgrade'u:
//  • cel FREE  → anulowanie subskrypcji w portalu Stripe; straty = limity Free
//                (galeria, klientki, znak wodny).
//  • cel PŁATNY (Scale→Studio, Pro Marka→Pro) → natychmiastowa zmiana planu
//                z proracją (usePlanChange); straty = entitlementy, które cel
//                realnie odbiera (kolor marki, przypięte, zespół, historia).
// Wcześniej oba przypadki dostawały copy „wróć na Free / anuluj subskrypcję",
// a po potwierdzeniu płatny cel szedł do plan-change — dialog kłamał, co się
// za chwilę stanie z pieniędzmi.

import { useCallback, useEffect, useRef, useId, type ReactNode } from 'react';
import posthog from 'posthog-js';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import {
  PricingPlanValue,
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { AppModalShellAtom } from '../../../primitives/AppModalShell.atom';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
import styles from './DowngradeWarningDialog.module.css';

export interface DowngradeWarningStats {
  galleryCount: number;
  pairedClientsCount: number;
}

export interface DowngradeWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  stats: DowngradeWarningStats;
  currentPlan: PricingPlan;
  targetPlan: PricingPlan;
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
}: DowngradeWarningDialogProps) {
  const t = useTranslations('account.pay.downgradeWarning');

  const cancelWrapRef = useRef<HTMLSpanElement>(null);
  const titleId = useId();

  // Default focus the CANCEL button (loss aversion — easy opt-out).
  const focusCancel = useCallback(
    () => cancelWrapRef.current?.querySelector<HTMLElement>('button') ?? null,
    []
  );

  // Churn-funnel event (wzorzec upgrade_prompt_shown): pokazanie ostrzeżenia
  // przed downgrade = mierzalna szansa retencji. Para: downgrade_confirmed
  // (useAccountPayActions) — shown bez confirmed = save. Effect zamiast
  // mount-capture, bo komponent jest zamontowany na stałe (isOpen toggluje
  // render null). Warunek lustrzany z early-return poniżej. Singleton
  // respektuje opt-out wewnętrznie.
  useEffect(() => {
    if (isOpen && currentPlan !== PricingPlanValue.FREE) {
      posthog.capture('downgrade_warning_shown', {
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

  const freeLossItems: { key: string; content: ReactNode }[] = [
    ...(stats.galleryCount > 0
      ? [
          {
            key: 'gallery',
            content: (
              <>
                <strong>
                  {t('lossGalleryCount', { count: stats.galleryCount })}
                </strong>{' '}
                {t('lossGallery', { limit: FREE_GALLERY_LIMIT })}
              </>
            ),
          },
        ]
      : []),
    ...(stats.pairedClientsCount > 0
      ? [
          {
            key: 'clients',
            content: (
              <>
                <strong>
                  {t('lossClientsCount', { count: stats.pairedClientsCount })}
                </strong>{' '}
                {t('lossClients')}
              </>
            ),
          },
        ]
      : []),
    {
      key: 'stats',
      content: (
        <>
          <strong>{t('lossStatsLabel')}</strong>: {t('lossStats')}
        </>
      ),
    },
    // The gallery line above already says „nie dodasz nowych ponad limit 5
    // zdjęć”. With it on screen this line repeated the limit and read as a
    // contradiction („Nieograniczona liczba zdjęć: limit … 5 zdjęć”, user-eyes
    // review 2026-10-09), so it shows only when she has no photos yet.
    ...(stats.galleryCount > 0
      ? []
      : [
          {
            key: 'unlimited',
            content: (
              <>
                <strong>{t('lossUnlimitedLabel')}</strong>:{' '}
                {t('lossUnlimited', { limit: FREE_GALLERY_LIMIT })}
              </>
            ),
          },
        ]),
  ];

  const lossItems = isToFree ? freeLossItems : paidLossItems;

  // Backdrop (scrim) + panel + focus-trap + scroll-lock + tło inert: w AppModalShell.
  // portal + inert='app-root': dialog ląduje w document.body (sibling #__next), więc
  // inertujemy #__next zamiast chodzić w górę od panelu. initialFocus=focusCancel
  // (loss aversion: domyślny focus na Anuluj). Klik-poza zamyka (target-check scrimu).
  return (
    <AppModalShellAtom
      variant='backdrop'
      portal
      inert='app-root'
      scrollLock
      role='alertdialog'
      labelledById={titleId}
      onClose={onClose}
      initialFocus={focusCancel}
      backdropClassName={styles.overlay}
      className={styles.dialog}>
      {/* Icon + title */}
      <div className={styles.header}>
        <WarningCircleIcon
          size={28}
          className={styles.warningIcon}
          aria-hidden='true'
        />
        <h2 id={titleId} className={styles.title}>
          {isToFree ? t('title') : t('paidTitle', { name: targetName })}
        </h2>
      </div>

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

      {/* CTAs — cancel is primary + default focus (loss aversion) */}
      <div className={styles.actions}>
        <span ref={cancelWrapRef} className={styles.cancelWrap}>
          <ButtonAtom
            variant='primary'
            size='lg'
            className={clsx(styles.btn, styles.btnCancel)}
            onClick={onClose}>
            {t('cancelCta')}
          </ButtonAtom>
        </span>
        <ButtonAtom
          variant='ghost'
          size='md'
          className={clsx(styles.btn, styles.btnConfirm)}
          onClick={onConfirm}>
          {isToFree
            ? t('confirmCta')
            : t('paidConfirmCta', { name: targetName })}
        </ButtonAtom>
      </div>
    </AppModalShellAtom>
  );
}
