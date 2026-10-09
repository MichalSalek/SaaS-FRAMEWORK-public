// UI/features/checkout/components/CheckoutForm.types.ts
// Kontrakty typów CheckoutForm — wydzielone z CheckoutForm.molecule, żeby ta
// trzymała się limitu max-lines. Tłumaczenia komponują podsumowanie (Netto/VAT/
// Brutto) + pola subformu „Faktura na firmę"; error-stringi VAT używane w handlePay
// (walidacja, zapis) zostają w kontrakcie tłumaczeń.

import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import type { PlanCheckoutSummaryTranslations } from './PlanCheckoutSummary.molecule';
import type { VatInvoiceFieldsTranslations } from './VatInvoiceFields.molecule';

export interface CheckoutFormTranslations
  extends PlanCheckoutSummaryTranslations, VatInvoiceFieldsTranslations {
  loadingPayment: string;
  initError: string;
  payNow: string;
  processing: string;
  cancel: string;
  secureHint: string;
  /** Generic confirm failure when Stripe gives no message. */
  confirmError: string;
  /** Neutral note when the post-success redirect is overdue (watchdog) — NOT a failure. */
  stillProcessing: string;
  /** Retry the payment after a recoverable stall/failure. */
  retry: string;
  /** NIP checksum failure. */
  nipInvalid: string;
  /** Generic „to pole jest wymagane" for empty subform fields. */
  vatFieldRequired: string;
  /** Postal code format (NN-NNN) failure. */
  vatPostalCodeInvalid: string;
  /** Backend save failure — shown inline, blocks confirm(). */
  vatSaveError: string;
}

export interface CheckoutFormProps {
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  showTrialNote: boolean;
  // exactOptionalPropertyTypes: accept an explicit `undefined` from the parent
  // (which passes its own optional `onCancel` straight through).
  onCancel: (() => void) | undefined;
  /**
   * Mint a fresh Checkout Session. Offered on the init-error view: Stripe could
   * not initialize THIS session, and re-minting (the panel's own retry) is the
   * in-app recovery; before, the view was a dead end that said "refresh".
   */
  onRetrySession?: (() => void) | undefined;
  /**
   * Reports whether a dismissal-blocking phase is active (confirm() network call
   * past its grace window, OR a confirmed-success redirect in flight). The parent
   * dialog gates Escape / backdrop / Cancel on this so the modal can never be
   * dismissed mid-payment. Called on every transition (idempotent same-value
   * calls are filtered here so the parent never re-renders needlessly).
   */
  onPaymentInFlightChange?: ((inFlight: boolean) => void) | undefined;
  /**
   * Reports whether the buyer has COMMITTED to paying — the pay button was
   * pressed and confirm() is in flight (incl. stall) OR a confirmed-success
   * redirect is settling. Broader than `onPaymentInFlightChange` (which fires
   * only on the confirmed-success phase, since the dialog deliberately keeps the
   * pre-success confirm dismissable to avoid trapping a stalled request). The
   * onboarding "start free" escape uses THIS to hide itself the moment a payment
   * attempt begins — switching the plan to FREE mid-confirm would unmount the
   * form and orphan a possibly-succeeding Stripe subscription.
   */
  onPaymentActiveChange?: ((active: boolean) => void) | undefined;
  /** id for the order-summary total, wired to the dialog's aria-describedby. */
  summaryDescribedById?: string | undefined;
  tx: CheckoutFormTranslations;
}
