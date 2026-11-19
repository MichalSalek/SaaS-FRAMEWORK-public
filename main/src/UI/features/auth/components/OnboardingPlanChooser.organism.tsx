import { PriceBlockMolecule } from './OnboardingPriceBlock.molecule';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { collapsedFirst } from './OnboardingPlanChooser.features';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { TRIAL_CONFIG } from '@kernel/domain/stripe/stripe.config';
import { CheckIcon, RocketLaunchIcon } from '@phosphor-icons/react';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import {
  usePricingPlans,
  type PricingPlanCard,
} from '../../shared/pricing/hooks/usePricingPlans';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import {
  BillingToggleMolecule,
  type BillingCycle,
} from '../../../components/BillingToggle/BillingToggle.molecule';
import { ONBOARDING_ACTION_SLOT_ID } from './OnboardingActionBar.molecule';
import styles from './OnboardingPlanChooser.module.css';

interface OnboardingPlanChooserProps {
  /** Watched form field — the currently selected plan. `null` only when a
   *  SCALE/invalid deep-link fell through the funnel with no plan; otherwise
   *  the pricing funnel's plan, or the PRO default when the chooser is the
   *  fallback after a failed Free activation (DECISION at ONBOARDING_DEFAULTS). */
  selectedPlanId: PricingPlan | null;
  /** Watched form field — the current billing cycle for the chosen plan. */
  billingPeriod: BillingPeriod;
  /** Tap a card → drive the form's `selected_plan_id`. */
  onSelectPlan: (planId: PricingPlan) => void;
  /** Toggle billing → drive the form's `billing_period`. */
  onSelectBilling: (period: BillingPeriod) => void;
  /** Primary CTA — go to payment (paid) or start on Free. */
  onProceed: () => void;
}

/** Tier sequence for the selectable cards; SCALE is handled as a contact row. */
const CARD_ORDER: readonly PricingPlan[] = [
  PricingPlanValue.FREE,
  PricingPlanValue.PRO,
  PricingPlanValue.PRO_PLUS,
  PricingPlanValue.STUDIO,
];

function toBillingPeriod(cycle: BillingCycle): BillingPeriod {
  return cycle === 'yearly' ? 'year' : 'month';
}

export function OnboardingPlanChooserOrganism({
  selectedPlanId,
  billingPeriod,
  onSelectPlan,
  onSelectBilling,
  onProceed,
}: OnboardingPlanChooserProps) {
  const t = useTranslations('pages.onboarding');
  const days = TRIAL_CONFIG.DURATION_DAYS;
  const tButtons = useTranslations('buttons');
  const taxNote = useTranslations('static.pricing.tierSection');
  const {
    data: plans,
    isPending,
    isFetching,
    refetch,
    pricesUnavailable,
    currency,
    country,
    internationalBillingEnabled,
    isCurrencyLocked,
  } = usePricingPlans();

  // Finding #4: SCALE row CTA opens contact, mirroring AccountPay's
  // handleContactSales (mailto BRAND_CONFIG.email.contact). location.assign()
  // (method call, not `location.href =`) so the React Compiler does not flag an
  // external-variable write. A click handler only runs in the browser.
  const handleContactSales = () => {
    window.location.assign(`mailto:${BRAND_CONFIG.email.contact}`);
  };

  // A retry from the error view keeps the query in `error` status while it
  // fetches, so `isPending` alone would leave the retry without feedback.
  if (isPending || (plans == null && isFetching)) {
    return (
      <p className={styles.notice} role='status'>
        {t('plansLoading')}
      </p>
    );
  }
  // Error view ONLY when there is nothing to show. The query re-polls every
  // 30 s while it is in error or on fallback prices, so `isError` alone also
  // fires on a failed BACKGROUND refetch with the plans still cached: that
  // swapped a working chooser (and its CTA in the action bar) for a dead
  // message. With no plans at all the step had no way forward, so the error
  // carries a manual retry.
  if (plans == null) {
    return (
      <ErrorStateMolecule
        message={t('plansLoadError')}
        retryLabel={tButtons('retry')}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
      />
    );
  }

  const cards = CARD_ORDER.map(id => plans.find(p => p.id === id)).filter(
    (p): p is PricingPlanCard => p != null
  );
  const scalePlan = plans.find(p => p.id === PricingPlanValue.SCALE);
  const cycle: BillingCycle = billingPeriod === 'year' ? 'yearly' : 'monthly';
  const isFreeSelected = selectedPlanId === PricingPlanValue.FREE;
  // Finding #3: Stripe prices are in fallback (is_fallback) → paid plans have
  // null prices (rendered as U+2212) and a paid checkout would hit a
  // resolve-price error. Lock paid card selection + the paid CTA and steer to
  // the Demo (FREE needs no Stripe price). Mirrors AccountPay's pricesUnavailable
  // gate (disableActions + a status notice).
  const marketLocked =
    country !== 'PL' && !isCurrencyLocked && !internationalBillingEnabled;
  const selectedPlan = cards.find(card => card.id === selectedPlanId);
  const selectedPrice =
    cycle === 'yearly'
      ? selectedPlan?.priceYearlyTotal
      : selectedPlan?.priceMonthly;
  const paidLocked =
    !isFreeSelected &&
    (pricesUnavailable || marketLocked || selectedPrice == null);

  // For each card: the feature set of ALL cheaper tiers (see the DECISION above
  // `collapsedFirst`). Computed once, in `CARD_ORDER` order.
  const cheaperFeatures: Partial<Record<PricingPlan, ReadonlySet<string>>> = {};
  const seenSoFar = new Set<string>();
  for (const card of cards) {
    cheaperFeatures[card.id] = new Set(seenSoFar);
    card.features.forEach(f => seenSoFar.add(f));
  }

  // She is on Free here, so the recommendation is the next purchasable step up
  // (resolveRecommendedPlanId in AccountPayPage.helpers.ts states the rule).
  const recommendedPlanId = cards.find(
    card => card.id !== PricingPlanValue.FREE && card.isCustom !== true
  )?.id;

  return (
    <>
      <BillingToggleMolecule
        variant='account'
        className={styles.toggleRow}
        cycle={cycle}
        onChange={next => onSelectBilling(toBillingPeriod(next))}
        monthlyLabel={t('planBillingMonthly')}
        yearlyLabel={t('planBillingYearly')}
        hintLabel={t('planBillingHint')}
      />

      {pricesUnavailable && (
        <p className={styles.pricesNotice} role='status'>
          {t('planChooserPricesUnavailable')}
        </p>
      )}

      <div className={styles.cardStack}>
        {cards.map(plan => {
          const isSel = plan.id === selectedPlanId;
          const isFree = plan.id === PricingPlanValue.FREE;
          const isRec = plan.id === recommendedPlanId;
          // Paid plans are unselectable while Stripe prices are unavailable
          // — only FREE/Demo can proceed without a resolved price.
          const cardLocked =
            !isFree &&
            (pricesUnavailable ||
              marketLocked ||
              (cycle === 'yearly'
                ? plan.priceYearlyTotal == null
                : plan.priceMonthly == null));
          // The trial note belongs to a PAID plan with a resolved price: Free has no trial, SCALE is priced
          // individually, and with Stripe fallback prices the card shows U+2212 and is disabled, so the
          // trial promise would hang over nothing.
          const priceForCycle =
            cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
          const showsTrial =
            !isFree && plan.isCustom !== true && priceForCycle !== null;
          const Icon = plan.icon;
          return (
            <button
              key={plan.id}
              type='button'
              aria-pressed={isSel}
              disabled={cardLocked}
              onClick={() => onSelectPlan(plan.id)}
              className={clsx(styles.card, styles.cardButton, {
                [styles.cardSelected ?? '']: isSel,
                [styles.cardRecommended ?? '']: isRec && !isSel,
              })}>
              <div className={styles.cardTop}>
                <div className={styles.cardNameRow}>
                  <span className={styles.iconHalo} aria-hidden='true'>
                    <Icon size={18} weight='duotone' />
                  </span>
                  <span className={styles.planName}>
                    {isFree ? t('planDemoName') : plan.name}
                    {isFree && (
                      <span className={styles.demoTag}>
                        {t('planDemoSublabel')}
                      </span>
                    )}
                  </span>
                </div>
                {isRec ? (
                  <span className={styles.badge}>{t('planPopularBadge')}</span>
                ) : (
                  <span
                    className={clsx(styles.radioDot, {
                      [styles.radioDotOn ?? '']: isSel,
                    })}
                    aria-hidden='true'>
                    {isSel && <CheckIcon size={12} weight='bold' />}
                  </span>
                )}
              </div>
              <div className={styles.priceRow}>
                <PriceBlockMolecule
                  plan={plan}
                  cycle={cycle}
                  t={t}
                  currency={currency}
                />
              </div>
              {/* A paid plan card showed ONLY the amount, so on the step where the decision is made the trial was
                                invisible (it lived only in the subtitle above the scroll). The owner rule says that for a
                                plan with a trial period the hero of the card is the ENTRY OFFER and the amount drops to
                                small print; `/pricing` does this with a full inversion via `PlanTrialFramingMolecule`.
                                Here the amount stayed in place (the card composition is the voted variant B), but the
                                trial is no longer invisible. A full inversion of the hierarchy = an owner decision, not a
                                silent change of the voted card. */}
              {showsTrial ? (
                <p className={styles.trialNote}>
                  {t('planTrialNote', { days })}
                </p>
              ) : null}
              <FeatureList
                features={collapsedFirst(
                  plan.features,
                  cheaperFeatures[plan.id]
                )}
                max={isSel ? 6 : 3}
              />
            </button>
          );
        })}

        {scalePlan != null && (
          <div className={styles.contactRow}>
            <span className={styles.contactText}>
              <RocketLaunchIcon size={15} weight='duotone' aria-hidden='true' />
              <span>
                <strong>{scalePlan.name}</strong> {t('planScaleRow')}
              </span>
            </span>
            <ButtonAtom
              variant='outlined'
              size='sm'
              onClick={handleContactSales}>
              {t('planScaleContact')}
            </ButtonAtom>
          </div>
        )}
      </div>

      <div className={styles.ctaStack}>
        {country === 'PL' && (
          <TypographyAtom variant='body2' as='p' align='center'>
            {taxNote('vatNote')}
          </TypographyAtom>
        )}

        <ActionSlotPortal>
          <ButtonAtom
            variant='primary'
            size='lg'
            className={clsx(styles.fullBtn, 'press-feedback')}
            onClick={onProceed}
            disabled={paidLocked || selectedPlanId === null}>
            {selectedPlanId === null
              ? t('planChooserCtaSelect')
              : isFreeSelected
                ? t('planChooserCtaFree')
                : t('planChooserCtaPaid')}
          </ButtonAtom>
        </ActionSlotPortal>
        {/* A card IS required for a paid plan, and the screen was silent about it: the first thing after
                    starting the trial was the card form. This does not question the card path;
                    it discloses it exactly where it happens. Same pattern as the objection-handling canon in
                    BRAND_BIBLE. */}
        {selectedPlanId !== null && !isFreeSelected && (
          <p className={styles.ctaNote}>{t('planTrialCardNote', { days })}</p>
        )}
      </div>
    </>
  );
}

/** Renders the CTA into the sticky action bar's slot (DECISION at
 *  ONBOARDING_ACTION_SLOT_ID); inline when the slot is absent. */
function ActionSlotPortal({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null | undefined>(undefined);
  useEffect(() => {
    setSlot(document.getElementById(ONBOARDING_ACTION_SLOT_ID));
  }, []);
  if (slot === undefined) {
    return null;
  }
  return slot ? createPortal(children, slot) : <>{children}</>;
}

function FeatureList({
  features,
  max,
}: {
  features: readonly string[];
  max: number;
}) {
  const shown = features.slice(0, max);
  return (
    <ul className={styles.featureList}>
      {shown.map(feature => (
        <li key={feature} className={styles.featureItem}>
          <span className={styles.featureCheck} aria-hidden='true'>
            <CheckIcon size={11} weight='bold' />
          </span>
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}
