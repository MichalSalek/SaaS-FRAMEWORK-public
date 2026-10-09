// UI/features/shared/upsell/TrialOfferCard.organism.tsx
// In-app upgrade offer at the moment of value: after the 3rd published piece,
// at the pin limit and at the client limit. Free-first entry (owner
// 2026-09-23, DOMAIN_SSOT §18): a stylist starts on Free without a plan
// decision, and the 30-day Pro trial is offered here instead of at sign-up.
// Renders ONLY for a stylist on Free; the trial promise only while she can
// still start it (kernel canStartTrial), otherwise a plain Pro offer.

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import posthog from 'posthog-js';
import { TrendUpIcon } from '@phosphor-icons/react';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { canStartTrial } from '@kernel/domain/pricing/pricing-policy';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import { NavCardOrganism } from '../../../components/NavCard/NavCard.organism';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { buildPlanPayDeepLink } from '../pricing/pricingFunnelHref';
import styles from './TrialOfferCard.module.css';

export type TrialOfferTrigger =
  'upload_third_photo' | 'pin_limit' | 'client_limit';

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
  const router = useRouter();
  const { data: user } = useCurrentUserAccount();
  const stylist = user?.stylist_account;
  const onFree =
    stylist != null &&
    narrowPricingPlan(stylist.pricing_plan) === PricingPlanValue.FREE;
  const trialAvailable = canStartTrial({
    trialStartedAt: stylist?.trial_started_at,
    paymentStatus: stylist?.payment_status,
  });

  // Same event as the gallery limit dialog and the locked client card, so the
  // upgrade funnel reads every trigger in one PostHog breakdown.
  useEffect(() => {
    if (onFree) {
      posthog.capture('upgrade_prompt_shown', {
        trigger,
        current_plan: PricingPlanValue.FREE,
        trial_available: trialAvailable,
      });
    }
  }, [onFree, trialAvailable, trigger]);

  if (!onFree) {
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
    <NavCardOrganism
      href={href}
      linkType='plain'
      onClick={event => {
        event.preventDefault();
        posthog.capture('upgrade_prompt_clicked', {
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
  );
}
