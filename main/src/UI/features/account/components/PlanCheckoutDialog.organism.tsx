// UI/features/account/components/PlanCheckoutDialog.organism.tsx
//
// SPE (W5): inline plan checkout for the account-pay page. Wraps the reusable
// W2 PlanCheckoutPanelOrganism (mode='account-pay') in a modal shell so a
// FREE-tier stylist can subscribe to a paid plan WITHOUT leaving the page (no
// bounce to the Stripe-hosted portal). The panel mints the Checkout Session for
// {planId, billingPeriod} and renders the embedded PaymentElement.
//
// Used ONLY for FREE → paid. Paid → paid changes go through usePlanChange
// (card on file, one-tap proration + inline SCA) and never open this dialog.

import { useCallback, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  PlanCheckoutPanelOrganism,
  type PlanCheckoutPanelTranslations,
} from '../../checkout/PlanCheckoutPanel.organism';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { AppModalShellAtom } from '../../../primitives/AppModalShell.atom';
import styles from './PlanCheckoutDialog.module.css';

interface PlanCheckoutDialogProps {
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  promo?: string;
  titleId: string;
  title: string;
  onClose: () => void;
}

export function PlanCheckoutDialogOrganism({
  planId,
  billingPeriod,
  promo,
  titleId,
  title,
  onClose,
}: PlanCheckoutDialogProps) {
  const c = useTranslations('account.checkout');

  // i18n-dumb panel bag, built from the shared checkout namespace (W2 contract).
  const tx: PlanCheckoutPanelTranslations = {
    preparing: c('preparing'),
    sessionError: c('sessionError'),
    promoInvalid: c('promoInvalid'),
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

  // CLOSE-GUARD: while a confirmed-success redirect is settling the modal must
  // not be dismissable by ANY path (Escape, backdrop click, or the panel's
  // Cancel) — abandoning here would strand a paid-but-unconfirmed session. The
  // embedded form bubbles the in-flight phase up; a ref backs the guard so the
  // close handlers stay referentially stable (no AppModalShell re-subscribe via
  // useFocusTrap's onEscape) and always read the latest value. The form ALSO
  // disables its own Cancel button on the same phase — guardedClose is the
  // belt-and-suspenders no-op behind it (and the only block for Escape/backdrop).
  const paymentInFlightRef = useRef(false);
  const handlePaymentInFlightChange = useCallback((inFlight: boolean) => {
    paymentInFlightRef.current = inFlight;
  }, []);
  const guardedClose = useCallback(() => {
    if (paymentInFlightRef.current) {
      return;
    }
    onClose();
  }, [onClose]);

  // aria-describedby target: the order-summary section (the transaction this
  // dialog is about), so SR users hear the plan + total tied to the dialog.
  const summaryId = useId();

  return (
    <AppModalShellAtom
      variant='backdrop'
      portal
      inert='app-root'
      scrollLock
      role='dialog'
      labelledById={titleId}
      describedById={summaryId}
      onClose={guardedClose}
      backdropClassName={styles.overlay}
      className={styles.dialog}>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <PlanCheckoutPanelOrganism
        planId={planId}
        billingPeriod={billingPeriod}
        {...(promo !== undefined ? { promo } : {})}
        mode='account-pay'
        onCancel={guardedClose}
        onPaymentInFlightChange={handlePaymentInFlightChange}
        summaryDescribedById={summaryId}
        tx={tx}
      />
    </AppModalShellAtom>
  );
}
