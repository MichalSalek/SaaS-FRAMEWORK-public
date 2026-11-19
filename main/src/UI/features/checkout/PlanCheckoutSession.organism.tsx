// UI/features/checkout/PlanCheckoutPanel.organism.tsx
//
// The single reusable embedded-checkout organism. Used in BOTH the onboarding flow and the
// account-pay upgrade flow (`mode` prop). On mount it asks the backend to mint a Checkout Session
// for {planId, billingPeriod} and then switches on the discriminated CheckoutSessionResponse:
//   free_selected     → no Stripe at all → invalidate account + onSuccess().
//   checkout_elements → render <StripeCustomCheckoutProvider> + <CheckoutForm> (embedded
//                       PaymentElement, native feel).
//   hosted_fallback   → controlled redirect to hosted Stripe Checkout.
//
// `useSelectPlan` was folded into `usePlanCheckout`: `free_selected` is just a `mode` branch of the
// SAME /checkout-session mutation, so a second hook would duplicate transport (rule of three: one
// call site, no abstraction yet).
// Stack: TQ v5 + @stripe/react-stripe-js/checkout + CSS Modules + Phosphor.

import { useEffect, useRef, useState } from 'react';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { isIOError } from '../../../application/http/io';
import { ExistingPlanNoticeMolecule } from './components/ExistingPlanNotice.molecule';
import { ExistingSubscriptionRecoveryMolecule } from './ExistingSubscriptionRecovery.molecule';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { CircleNotchIcon } from '@phosphor-icons/react';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import type {
  BillingCurrency,
  CountryCode,
} from '@kernel/domain/localization/country.config';
import type { BillingProfile } from '@kernel/domain/account/billing-profile.contract-schemas';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import {
  CheckoutSessionErrorMolecule,
  isCheckoutTermsChanged,
} from './components/CheckoutSessionError.molecule';
import { usePlanCheckout } from '../shared/checkout/hooks/usePlanCheckout';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { canStartTrial } from '@kernel/domain/pricing/pricing-policy';
import { TRIAL_CONFIG } from '@kernel/domain/stripe/stripe.config';
import { StripeCustomCheckoutOrganism } from './StripeCustomCheckout.organism';
import {
  CheckoutFormMolecule,
  type CheckoutFormTranslations,
} from './components/CheckoutForm.molecule';
import styles from './PlanCheckoutPanel.module.css';
import { resolveCheckoutConfirmationUrl } from './checkout-confirmation.helpers';

type PlanCheckoutMode = 'onboarding' | 'account-pay';

export interface PlanCheckoutPanelTranslations extends CheckoutFormTranslations {
  /** Status while the Checkout Session is being created. */
  preparing: string;
  /** Error when session creation fails. */
  sessionError: string;
  /** Shown when the server refused `promo` and minted a full-price session. */
  promoInvalid?: string;
  // `retry` lives on CheckoutFormTranslations (the embedded form's stall view
  // reuses it); inherited here for the session-error retry button.
}

export interface PlanCheckoutPanelProps {
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  promo?: string;
  mode: PlanCheckoutMode;
  // Only the `free_selected` branch fires this (no argument). The paid
  // `checkout_elements` path resolves via Stripe's redirect to the return page,
  // so there is no sessionId to hand back here — hence the bare `() => void`.
  // Optional: the account-pay dialog is Free→paid only, where `free_selected`
  // is unreachable, so it has nothing to hand back.
  onSuccess?: () => void;
  onCancel?: () => void;
  /**
   * Bubbled from the embedded form: a confirmed-success redirect or tax-portal
   * handoff is settling. The surrounding decision blocks dismissal, matching
   * the form's Cancel while leaving a bare recoverable confirm escapable.
   */
  onPaymentInFlightChange?: (inFlight: boolean) => void;
  /**
   * Bubbled "panel is committing" signal for the onboarding shell.
   * True while EITHER a PAID confirm()/redirect is in flight (from the
   * embedded form) OR the FREE `free_selected` mutation is still committing the
   * plan on the backend. The onboarding step gates BOTH its "Zmień plan" link
   * AND the sticky global Back on this, so a payment/activation can never be
   * interrupted mid-flight: a mid-confirm plan switch (or Back) would orphan a
   * succeeding Stripe subscription, and a mid-free-mutation unmount would strand
   * the account with FREE set but no onSuccess/invalidate ever firing.
   */
  onBusyChange?: (busy: boolean) => void;
  /** id for the order-summary total, wired to the dialog's aria-describedby. */
  summaryDescribedById?: string;
  tx: PlanCheckoutPanelTranslations;
}

// hosted_fallback redirect: window.location.assign() returns immediately and the
// page should unload. If it does not (popup/redirect blocked, sandboxed context)
// within this grace window we are still mounted → surface the error/retry view
// instead of a hanging "preparing" spinner (parity with the embedded path).
const HOSTED_NAV_GRACE_MS = 4_000;

export function PlanCheckoutSessionOrganism({
  planId,
  billingPeriod,
  promo,
  mode,
  onSuccess,
  onCancel,
  onPaymentInFlightChange,
  onBusyChange,
  summaryDescribedById,
  tx,
  currency,
  billingCountry,
  billingProfile,
  billingProfileUnverified,
}: PlanCheckoutPanelProps & {
  currency?: BillingCurrency;
  billingCountry?: CountryCode;
  billingProfile?: BillingProfile;
  billingProfileUnverified?: boolean;
}) {
  const summaryT = useTranslations('account.checkout.summary');
  const c = useTranslations('account.checkout');
  const queryClient = useQueryClient();
  const checkout = usePlanCheckout();
  const accountQuery = useCurrentUserAccount();
  const account = accountQuery.data?.stylist_account;
  const eligibilityResolved =
    planId === PricingPlanValue.FREE || Boolean(account);
  const expectedTrialDays =
    account &&
    canStartTrial({
      trialStartedAt: account.trial_started_at,
      paymentStatus: account.payment_status,
    })
      ? TRIAL_CONFIG.DURATION_DAYS
      : 0;
  const { mutate } = checkout;

  // Findings #1/#2 — a single "panel busy" signal surfaced to the onboarding
  // shell. PAID: confirm()/redirect in flight, bubbled from the embedded form
  // into `paidActive`. FREE: the `free_selected` mutation is committing the plan
  // (or about to — locked from mount until it resolves), so leaving now would
  // unmount before onSuccess invalidates + advances. A PAID session-mint is NOT
  // busy (nothing committed yet), hence the free lock is scoped to planId ===
  // FREE and released only on the error/retry view (`checkout.isError`).
  const [paidActive, setPaidActive] = useState(false);
  const freeBusy = planId === PricingPlanValue.FREE && !checkout.isError;
  const busy = paidActive || freeBusy;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  // Release the parent's lock if we unmount while still busy (success navigates the whole step away
  // mid-busy) so the sticky Back is never left disabled. Dep [onBusyChange] instead of disabling the
  // exhaustive-deps rule (react-compiler refuses to optimise a component with the rule disabled):
  // when the callback identity changes, cleanup(false) fires BEFORE the re-run of the
  // [busy, onBusyChange] effect above, which immediately restores the right state — net the same as
  // unmount-only, without breaking rules.
  useEffect(
    () => () => {
      onBusyChange?.(false);
    },
    [onBusyChange]
  );
  // hosted_fallback redirect failed (assign threw, or the page never unloaded).
  // Drives the same error/retry view as a failed session mint.
  const [navFailed, setNavFailed] = useState(false);
  const navWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (navWatchdogRef.current !== null) {
        clearTimeout(navWatchdogRef.current);
      }
    },
    []
  );

  const requestedKey = useRef<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  useEffect(() => {
    if (!eligibilityResolved) {
      return;
    }
    const key = `${planId}:${billingPeriod}:${promo ?? ''}:${currency ?? ''}:${billingCountry ?? ''}`;
    if (requestedKey.current === key) {
      return;
    }
    const timer = setTimeout(() => {
      requestedKey.current = key;
      mutate(
        {
          planId,
          billingPeriod,
          source: mode,
          ...(planId !== PricingPlanValue.FREE && { expectedTrialDays }),
          ...(promo ? { promo } : {}),
          ...(currency ? { currency } : {}),
          ...(billingCountry ? { billingCountry } : {}),
        },
        {
          onSuccess: response => {
            switch (response.mode) {
              case 'free_selected':
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.account.current,
                });
                // Plan limits changed → usage-vs-limit stats must re-derive.
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.account.usageStats,
                });
                onSuccess?.();
                return;
              case 'checkout_elements':
                // Rendered below via `checkout.data` — nothing to do here.
                return;
              case 'hosted_fallback':
                if (typeof window !== 'undefined') {
                  try {
                    window.location.assign(response.url);
                  } catch {
                    // assign() can throw in sandboxed / locked-down contexts.
                    setNavFailed(true);
                    return;
                  }
                  // assign() returns immediately; the page should unload. If we are
                  // still mounted after the grace window the redirect was blocked —
                  // surface the error/retry view (no hanging "preparing" spinner).
                  if (navWatchdogRef.current !== null) {
                    clearTimeout(navWatchdogRef.current);
                  }
                  navWatchdogRef.current = setTimeout(() => {
                    setNavFailed(true);
                  }, HOSTED_NAV_GRACE_MS);
                } else {
                  // No window (SSR / non-browser) → cannot redirect at all.
                  setNavFailed(true);
                }
                return;
              default: {
                const _exhaustive: never = response;
                return _exhaustive;
              }
            }
          },
        }
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [
    planId,
    billingPeriod,
    expectedTrialDays,
    eligibilityResolved,
    promo,
    currency,
    billingCountry,
    mode,
    mutate,
    onSuccess,
    queryClient,
    retryNonce,
  ]);

  const handleRetry = () => {
    requestedKey.current = null;
    if (navWatchdogRef.current !== null) {
      clearTimeout(navWatchdogRef.current);
      navWatchdogRef.current = null;
    }
    setNavFailed(false);
    checkout.reset();
    setRetryNonce(n => n + 1);
  };

  /* ── Error — session creation failed, OR a hosted-redirect that never landed ── */
  if (
    isIOError(checkout.error) &&
    checkout.error.httpError.event ===
      APP_EVENTS.INFO.ACCOUNT.CANNOT_CHANGE_PRICING_PLAN
  ) {
    return planId === PricingPlanValue.FREE ? (
      <ExistingPlanNoticeMolecule />
    ) : (
      <ExistingSubscriptionRecoveryMolecule />
    );
  }
  const accountFailed =
    !eligibilityResolved && (accountQuery.isError || accountQuery.isSuccess);
  const termsChanged = isCheckoutTermsChanged(checkout.error);
  if (accountFailed || termsChanged || checkout.isError || navFailed) {
    return (
      <CheckoutSessionErrorMolecule
        message={
          termsChanged
            ? c('termsChanged')
            : planId === PricingPlanValue.FREE
              ? c('freeSessionError')
              : tx.sessionError
        }
        action={termsChanged ? c('reloadOffer') : tx.retry}
        onAction={
          termsChanged
            ? () => window.location.reload()
            : accountFailed
              ? () => void accountQuery.refetch()
              : handleRetry
        }
      />
    );
  }

  /* ── Embedded checkout surface (the happy path) ── */
  if (checkout.isSuccess && checkout.data.mode === 'checkout_elements') {
    return (
      <StripeCustomCheckoutOrganism
        clientSecret={checkout.data.clientSecret}
        {...(billingCountry && { billingCountry })}
        {...(billingProfile && { billingProfile })}>
        {promo?.trim() ? (
          <p className={styles.statusText} role='status'>
            {summaryT('promoConditions')}
          </p>
        ) : null}
        {checkout.data.promoRejected && tx.promoInvalid ? (
          <p className={styles.statusText} role='status'>
            {tx.promoInvalid}
          </p>
        ) : null}
        <CheckoutFormMolecule
          planId={planId}
          billingPeriod={billingPeriod}
          source={mode}
          {...(currency && { currency })}
          {...(promo && { promo })}
          {...(billingCountry && { billingCountry })}
          {...(billingProfile && { billingProfile })}
          {...(billingProfileUnverified && { billingProfileUnverified: true })}
          {...(checkout.data.billingAddressRequired && {
            billingAddressRequired: true,
          })}
          onConfirmed={sessionId => {
            if (checkout.data.mode === 'checkout_elements') {
              window.location.assign(
                resolveCheckoutConfirmationUrl(
                  checkout.data.returnUrl,
                  sessionId
                )
              );
            }
          }}
          onCancel={onCancel}
          onRetrySession={handleRetry}
          onPaymentInFlightChange={onPaymentInFlightChange}
          onPaymentActiveChange={setPaidActive}
          summaryDescribedById={summaryDescribedById}
          tx={tx}
        />
      </StripeCustomCheckoutOrganism>
    );
  }

  /* ── Preparing — creating session, or free/hosted resolving (redirect/onSuccess
        already fired in onSuccess; we keep a spinner until navigation/unmount) ── */
  return (
    <div className={styles.statusViewport} role='status'>
      <CircleNotchIcon
        size={32}
        className={`${styles.statusIcon} ${styles.spinner}`}
        aria-hidden='true'
      />
      <p className={styles.statusText}>
        {planId === PricingPlanValue.FREE ? c('preparingFree') : tx.preparing}
      </p>
    </div>
  );
}
