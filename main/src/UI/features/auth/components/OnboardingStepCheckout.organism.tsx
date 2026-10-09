// UI/features/auth/components/OnboardingStepCheckout.organism.tsx
//
// SPE-W4 — Step 5 (stylist only): plan CHOICE + embedded payment.
//
// Two stages inside one tight mobile step:
//   'choose' → OnboardingPlanChooserOrganism (owner-voted Variant B cards). A tap
//              drives the form's selected_plan_id / billing_period; the primary
//              CTA proceeds ("Zacznij 30 dni za darmo" for a paid plan, "Zacznij
//              za darmo" for FREE).
//   'pay'    → PlanCheckoutPanelOrganism (W2) for the chosen {planId, billingPeriod}.
//              A paid plan renders the embedded PaymentElement; FREE resolves as
//              `free_selected` (no card, no trial) → onSuccess. A quiet "Zmień
//              plan" link returns to the chooser (blocked mid-confirm).
//
// DECISION (nie usuwaj tego komentarza):
// - Panel translations are built from `account.checkout.*` (W2's namespace,
//   identical surface) rather than duplicating ~16 keys under pages.onboarding —
//   the panel is i18n-dumb by contract (PlanCheckoutPanelTranslations). The
//   onboarding header + chooser copy stays in pages.onboarding.
// - The composition still owns submit/advance: it created the account on leaving
//   PREFERENCES, watches selected_plan_id / billing_period, and passes them plus
//   the setValue callbacks (onSelectPlan / onSelectBilling) + onSuccess /
//   onStartFree down here. This organism only owns the local choose→pay stage.
// - FREE proceed calls onStartFree (keeps the form on FREE, its documented job)
//   THEN advances to the pay stage so the panel mints `free_selected` and commits
//   the choice — the panel is the single place that talks to /checkout-session.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CreditCardIcon,
  ListChecksIcon,
  ArrowLeftIcon,
} from '@phosphor-icons/react';
import {
  PlanCheckoutPanelOrganism,
  type PlanCheckoutPanelTranslations,
} from '../../checkout/PlanCheckoutPanel.organism';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { OnboardingPlanChooserOrganism } from './OnboardingPlanChooser.organism';
import styles from '../OnboardingPage.module.css';

interface OnboardingStepCheckoutProps {
  planId: PricingPlan | null;
  billingPeriod: BillingPeriod;
  /** Tap a card → drive the form's `selected_plan_id`. */
  onSelectPlan: (planId: PricingPlan) => void;
  /** Toggle billing → drive the form's `billing_period`. */
  onSelectBilling: (period: BillingPeriod) => void;
  /** Plan selected / paid — advance to the success view. */
  onSuccess: () => void;
  /**
   * FREE path: keep the funnel on the FREE plan (no card, no trial). Owner
   * decision (2026-07-03). Called on FREE-proceed before the panel mints
   * `free_selected`; idempotent with the chooser's own selection.
   */
  onStartFree: () => void;
  /**
   * Bubble the panel's "busy" state (paid confirm in flight OR free activation
   * committing) up to the composition so the sticky global Back can be locked
   * while a payment/activation is in flight (finding #1).
   */
  onCheckoutBusyChange: (busy: boolean) => void;
}

type CheckoutStage = 'choose' | 'pay';

export function OnboardingStepCheckoutOrganism({
  planId,
  billingPeriod,
  onSelectPlan,
  onSelectBilling,
  onSuccess,
  onStartFree,
  onCheckoutBusyChange,
}: OnboardingStepCheckoutProps) {
  const t = useTranslations('pages.onboarding');
  const c = useTranslations('account.checkout');

  const [stage, setStage] = useState<CheckoutStage>('choose');
  // Panel-busy: paid confirm()/redirect in flight OR the free `free_selected`
  // mutation committing. Gates the local "Zmień plan" link (finding #2) AND, via
  // onCheckoutBusyChange, the sticky global Back up in the composition (finding
  // #1) — a payment/activation must never be interrupted mid-flight (leaving
  // would orphan a succeeding subscription or strand an in-flight free activation).
  const [busy, setBusy] = useState(false);
  const handleBusyChange = (next: boolean) => {
    setBusy(next);
    onCheckoutBusyChange(next);
  };

  const isFree = planId === PricingPlanValue.FREE;

  const handleProceed = () => {
    // planId is null only when a crafted `?planId=SCALE`/invalid deep-link fell
    // through the funnel with no plan (otherwise the funnel's plan, or the PRO
    // default on the fallback chooser: DECISION at ONBOARDING_DEFAULTS). The
    // CTA is disabled in that state; this guard is the belt-and-braces against
    // a null reaching pay.
    if (planId === null) {
      return;
    }
    // FREE proceed: keep the form on FREE (documented onStartFree job) then let
    // the panel mint `free_selected` on the pay stage — the panel is the single
    // caller of /checkout-session, for both the free and paid resolutions.
    if (planId === PricingPlanValue.FREE) {
      onStartFree();
    }
    setStage('pay');
  };

  // Build the i18n-dumb panel bag from the shared checkout namespace (W2).
  const tx: PlanCheckoutPanelTranslations = {
    preparing: c('preparing'),
    sessionError: c('sessionError'),
    retry: c('retry'),
    loadingPayment: c('loadingPayment'),
    initError: c('initError'),
    payNow: c('payNow'),
    processing: c('processing'),
    cancel: c('cancel'),
    secureHint: c('secureHint'),
    confirmError: c('confirmError'),
    stillProcessing: c('stillProcessing'),
    cycleMonthly: c('cycleMonthly'),
    cycleYearly: c('cycleYearly'),
    totalLabel: c('totalLabel'),
    netLabel: c('netLabel'),
    vatLabel: c('vatLabel'),
    grossLabel: c('grossLabel'),
    trialTitle: c('trialTitle'),
    trialSub: c('trialSub'),
    vatInvoiceToggle: c('vatInvoiceToggle'),
    vatInvoiceHint: c('vatInvoiceHint'),
    companyNameLabel: c('companyNameLabel'),
    companyNamePlaceholder: c('companyNamePlaceholder'),
    addressLine1Label: c('addressLine1Label'),
    addressLine1Placeholder: c('addressLine1Placeholder'),
    cityLabel: c('cityLabel'),
    cityPlaceholder: c('cityPlaceholder'),
    postalCodeLabel: c('postalCodeLabel'),
    postalCodePlaceholder: c('postalCodePlaceholder'),
    nipLabel: c('nipLabel'),
    nipPlaceholder: c('nipPlaceholder'),
    nipInvalid: c('nipInvalid'),
    vatFieldRequired: c('vatFieldRequired'),
    vatPostalCodeInvalid: c('vatPostalCodeInvalid'),
    vatSaveError: c('vatSaveError'),
  };

  const isChoose = stage === 'choose';
  // Pay-stage subtitle: the trial framing only fits a PAID plan; FREE gets a
  // short "activating your Demo" note (the panel self-resolves in a beat).
  const subtitle = isChoose
    ? t('planChooserSubtitle')
    : isFree
      ? t('checkoutDemoSubtitle')
      : t('checkoutSubtitle');

  return (
    <>
      <div className={styles.stepHeader}>
        <div className={styles.stepHeaderTop}>
          <span className={styles.stepHeaderOrb} aria-hidden='true'>
            {isChoose ? (
              <ListChecksIcon size={26} weight='duotone' />
            ) : (
              <CreditCardIcon size={26} weight='duotone' />
            )}
          </span>
          <TypographyAtom variant='h3' className={styles.stepTitle}>
            {t('checkoutTitle')}
          </TypographyAtom>
        </div>
        <p className={styles.stepSubtitle}>{subtitle}</p>
      </div>

      {isChoose ? (
        <OnboardingPlanChooserOrganism
          selectedPlanId={planId}
          billingPeriod={billingPeriod}
          onSelectPlan={onSelectPlan}
          onSelectBilling={onSelectBilling}
          onProceed={handleProceed}
        />
      ) : planId !== null ? (
        <>
          <div className={styles.checkoutCard}>
            <PlanCheckoutPanelOrganism
              planId={planId}
              billingPeriod={billingPeriod}
              mode='onboarding'
              onSuccess={onSuccess}
              onBusyChange={handleBusyChange}
              tx={tx}
            />
          </div>

          {/* Quiet "change plan" escape back to the chooser — hidden once the
              panel is busy (paid confirm in flight OR a free activation
              committing). A mid-confirm plan switch would orphan a succeeding
              Stripe subscription, and unmounting during the free `free_selected`
              mutation would strand the account with no onSuccess/invalidate.
              Never competes with the panel's primary pay / trial CTA. */}
          {!busy && (
            <div className={styles.checkoutFreeEscape}>
              <ButtonAtom
                variant='text'
                size='md'
                icon={<ArrowLeftIcon size={16} />}
                onClick={() => setStage('choose')}>
                {t('planChangeCta')}
              </ButtonAtom>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
