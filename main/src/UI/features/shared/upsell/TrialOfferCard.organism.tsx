import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
// UI/features/shared/upsell/TrialOfferCard.organism.tsx
// Optional, dismissible offer after the third published photo. A new stylist
// starts with Free Demo; the paid-plan trial belongs to this in-app context.
// Renders ONLY for a stylist on Free; the trial promise only while she can
// still start it (kernel canStartTrial), otherwise a plain Pro offer.

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { capturePosthog } from '../../../../application/analytics/posthog-client';
import { TrendUpIcon } from '@phosphor-icons/react';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { canStartTrial } from '@kernel/domain/pricing/pricing-policy';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import { NavCardOrganism } from '../../../components/NavCard/NavCard.organism';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { buildPlanPayDeepLink } from '../pricing/pricingFunnelHref';
import { useOptionalSuccessOfferSnooze } from './useOptionalSuccessOfferSnooze';
import { useQuotaTranslations } from './quotaTranslations';
import styles from './TrialOfferCard.module.css';

export type TrialOfferTrigger = 'upload_third_photo';

const FREE = PRICING_POLICY.LIMITS.FREE;
const PRO = PRICING_POLICY.LIMITS.PRO;

export function TrialOfferCardOrganism({
  trigger,
  nested = false,
}: {
  trigger: TrialOfferTrigger;
  /** Rendered inside a white card: use the page tone so the card keeps an edge. */
  nested?: boolean;
}) {
  const t = useTranslations('components.trialOffer');
  const tCopy = useQuotaTranslations();
  const router = useRouter();
  const { data: user } = useCurrentUserAccount();
  const snooze = useOptionalSuccessOfferSnooze(user?.id ?? null);
  const stylist = user?.stylist_account;
  const onFree =
    stylist != null &&
    narrowPricingPlan(getEffectivePricingPlan(stylist)) ===
      PricingPlanValue.FREE;
  const trialAvailable = canStartTrial({
    trialStartedAt: stylist?.trial_started_at,
    paymentStatus: stylist?.payment_status,
  });

  // Uses the shared upgrade-prompt event so the funnel reads every trigger in
  // one PostHog breakdown.
  useEffect(() => {
    if (onFree && !snooze.isSnoozed) {
      capturePosthog('upgrade_prompt_shown', {
        trigger,
        current_plan: PricingPlanValue.FREE,
        trial_available: trialAvailable,
      });
    }
  }, [onFree, snooze.isSnoozed, trialAvailable, trigger]);

  if (!onFree || snooze.isSnoozed) {
    return null;
  }

  const href = buildPlanPayDeepLink(PricingPlanValue.PRO, 'month');
  const values = {
    photos: FREE.max_gallery_records,
    clients: FREE.max_paired_clients,
    freePins: FREE.max_pinned_records,
    proPins: PRO.max_pinned_records,
  };
  const body = t(`${trigger}.body`, values);

  return (
    <div className={styles.offer}>
      <NavCardOrganism
        href={href}
        linkType='plain'
        onClick={event => {
          event.preventDefault();
          capturePosthog('upgrade_prompt_clicked', {
            trigger,
            current_plan: PricingPlanValue.FREE,
            trial_available: trialAvailable,
          });
          void router.push(href);
        }}
        icon={<TrendUpIcon size={20} weight='bold' />}
        eyebrow={trialAvailable ? t('eyebrowTrial') : t('eyebrowUpgrade')}
        title={t(`${trigger}.title`)}
        body={trialAvailable ? `${body} ${t('trialSuffix')}` : body}
        {...(nested ? { className: styles.nested } : {})}
      />
      <ButtonAtom variant='text' size='sm' onClick={snooze.dismiss}>
        {tCopy('components.trialOffer.dismiss')}
      </ButtonAtom>
    </div>
  );
}
