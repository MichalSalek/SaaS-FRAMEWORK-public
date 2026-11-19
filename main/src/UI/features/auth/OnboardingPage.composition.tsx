// UI/features/auth/OnboardingPage.composition.tsx
// Onboarding = one required role choice and optional email opt-in (owner; DECISION and the reasons in onboarding.types.ts),
// plus the plan + payment step for a stylist who arrived with an explicit plan intent.
//
//   stylist: ROLE [→ CHECKOUT]   (CHECKOUT only with a plan intent, useOnboardingFreeStart;
//                                 Free otherwise)
//   client : ROLE
//   → SUCCESS   terminal view; the stylist's primary action is her first photo
//
// Submit timing: the ONBOARD_AS_* mutation fires on leaving ROLE.
//   - client : submit → success view.
//   - stylist: with a plan intent: CHECKOUT (the account must exist before the checkout-session
//              endpoint can mint a session) → panel onSuccess → success view; without one: Free is
//              activated in place → success view (chooser only as the fallback).
// Stack: react-hook-form FormProvider + TanStack Query mutation + CSS Modules.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { usePricingFunnelState } from '../../shared/hooks/usePricingFunnelState';
import { authClient } from '../../../application/auth/better-auth-client';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { trackFlowStep } from '../../../application/analytics/flow-events';
import { captureOnboardingCompleted } from '../../../application/analytics/onboarding-events';
import { OnboardingEntryGateMolecule } from './components/OnboardingEntryGate.molecule';
import { OnboardingProcessHeaderMolecule } from './components/OnboardingProcessHeader.molecule';
import { OnboardingStepRoleOrganism } from './components/OnboardingStepRole.organism';
import { OnboardingStepCheckoutOrganism } from './components/OnboardingStepCheckout.organism';
import { OnboardingSuccessViewOrganism } from './components/OnboardingSuccessView.organism';
import { OnboardingActionBarMolecule } from './components/OnboardingActionBar.molecule';
import { useCompleteOnboarding } from './hooks/useCompleteOnboarding';
import { useOnboardingRolePrefill } from './hooks/useOnboardingRolePrefill';
import { useOnboardingFreeStart } from './hooks/useOnboardingFreeStart';
import { useStepScrollReset } from './hooks/useStepScrollReset';
import {
  ONBOARDING_DEFAULTS,
  ONBOARDING_STEP,
  type OnboardingFormValues,
  type OnboardingRole,
} from './onboarding.types';
import {
  isOnboardingRole,
  readPrefilledRole,
  selectsPlan,
  stylistSuccessOffersPaidPlan,
  stepSequenceForRole,
  stepPositionForRole,
  totalStepsForRole,
} from './onboarding.helpers';
import {
  clientOnboardPayload,
  makePlanFieldSetters,
  onboardingNavTitle,
  stylistOnboardPayload,
} from './OnboardingPage.parts.helpers';
import {
  isFromStylistProfile,
  isFromProfileMessage,
  resolvePostLoginTarget,
} from './LoginPage.helpers';
import styles from './OnboardingPage.module.css';

/* ─── Component ─── */

export function OnboardingPageComposition() {
  return (
    <OnboardingEntryGateMolecule>
      <OnboardingFlowComposition />
    </OnboardingEntryGateMolecule>
  );
}

function OnboardingFlowComposition() {
  const t = useTranslations('pages.onboarding');
  const router = useRouter();
  const { clearPricingFunnel } = usePricingFunnelState();
  const { data: session } = authClient.useSession();
  // The account query backs up the session's one-shot fetch, so
  // the Google name still reaches the profile when that fetch did not land.
  const { data: currentUser } = useCurrentUserAccount();

  const prefilledRole = useMemo(
    () => readPrefilledRole(router.query),
    [router.query]
  );

  const methods = useForm<OnboardingFormValues>({
    defaultValues: {
      ...ONBOARDING_DEFAULTS,
      role: prefilledRole ?? ONBOARDING_DEFAULTS.role,
      // The entry gate waits for this account. Re-entering with an existing role preserves its
      // saved choice instead of turning marketing off before the person has touched the checkbox.
      email_marketing:
        currentUser?.stylist_account?.email_preferences?.marketing ?? false,
    },
  });

  // `?role=` → pricing funnel → owned account; pristine fields only.
  useOnboardingRolePrefill(methods, prefilledRole);

  const [currentStep, setCurrentStep] = useState<number>(ONBOARDING_STEP.ROLE);
  const [showSuccess, setShowSuccess] = useState(false);
  // The plan the success view may name. Null until a stylist completion
  // reports one. Unknown is not Free.
  const [completedPlan, setCompletedPlan] = useState<PricingPlan | null>(null);
  // The role whose account the onboard mutation already created: a stylist
  // who steps Back from CHECKOUT re-advances without a second mutation unless
  // the email choice changed; switching roles runs the mutation for that role.
  const [createdRole, setCreatedRole] = useState<OnboardingRole | null>(null);
  const submittedMarketingRef = useRef<boolean | null>(null);
  const [stepDir, setStepDir] = useState<'forward' | 'back'>('forward');
  // The checkout panel bubbles a "busy" flag (paid confirm in flight OR a free
  // activation committing). While busy, Back is locked so it can never unmount
  // the panel mid-payment/activation.
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  // One-shot error-shake for the primary CTA (no role or a rejected submit).
  const [shake, setShake] = useState(false);
  const { mutate, isPending } = useCompleteOnboarding();

  /** Stylist finished (plan resolved: paid, trial or Free) → success view. */
  const completeStylist = (
    planId: PricingPlan | null,
    period: BillingPeriod
  ) => {
    setCompletedPlan(planId);
    captureOnboardingCompleted('stylist', planId, period);
    clearPricingFunnel();
    setShowSuccess(true);
  };
  const freeStart = useOnboardingFreeStart({
    onCheckoutStep: () => {
      setStepDir('forward');
      setCurrentStep(ONBOARDING_STEP.CHECKOUT);
    },
    onFreeActivated: completeStylist,
  });
  const { withCheckout, isActivating, advanceStylist } = freeStart;
  // Synchronous submit re-entry guard: `isPending` lags a render behind a
  // rapid double tap, so it cannot stop the second mutate() of the same burst.
  // Cleared on both outcomes so a retry after a failure works.
  const submitInFlightRef = useRef(false);

  // scroll-reset-allow: reset lives in hooks/useStepScrollReset; it also
  // rescues focus lost by a step change onto the step card it returns.
  const stepFocusTarget = useStepScrollReset(currentStep, showSuccess);

  const navTitle = onboardingNavTitle(showSuccess, t);
  useAppBarTitle(navTitle);

  const role = methods.watch('role');
  const selectedPlanId = methods.watch('selected_plan_id');
  const billingPeriod = methods.watch('billing_period');
  const totalSteps = totalStepsForRole(role, withCheckout);
  const stepPosition = stepPositionForRole(currentStep, role, withCheckout);
  const submitting = isPending || isActivating;
  const isCheckoutStep = currentStep === ONBOARDING_STEP.CHECKOUT;

  // One named trace per screen of the flow (DECISION in flow-events.ts).
  useEffect(() => {
    if (showSuccess) {
      return;
    }
    trackFlowStep(
      'onboarding',
      currentStep === ONBOARDING_STEP.CHECKOUT ? 'checkout_viewed' : 'viewed'
    );
  }, [currentStep, showSuccess]);

  const finishClient = () => {
    captureOnboardingCompleted('client');
    clearPricingFunnel();
    setShowSuccess(true);
  };

  /* ── Leaving ROLE = submit (creates the account for the picked role) ── */
  const handleStart = () => {
    if (!isOnboardingRole(role)) {
      void methods.trigger('role');
      setShake(true);
      return;
    }
    if (
      createdRole === role &&
      (role !== 'stylist' ||
        submittedMarketingRef.current === methods.getValues('email_marketing'))
    ) {
      if (selectsPlan(role)) {
        advanceStylist();
      } else {
        finishClient();
      }
      return;
    }
    if (submitInFlightRef.current) {
      return;
    }
    submitInFlightRef.current = true;
    trackFlowStep('onboarding', 'role_selected', { role });
    const payload =
      role === 'stylist'
        ? stylistOnboardPayload(
            session?.user?.name || currentUser?.name,
            methods.getValues('email_marketing')
          )
        : clientOnboardPayload();
    mutate(payload, {
      onSuccess: () => {
        submitInFlightRef.current = false;
        setCreatedRole(role);
        if (payload.role === 'stylist') {
          submittedMarketingRef.current = payload.email_marketing ?? false;
        }
        trackFlowStep('onboarding', 'submitted', { role });
        if (selectsPlan(role)) {
          advanceStylist();
        } else {
          finishClient();
        }
      },
      onError: () => {
        submitInFlightRef.current = false;
        trackFlowStep('onboarding', 'failed', { role });
        setShake(true);
      },
    });
  };

  const handleBack = () => {
    setStepDir('back');
    setCurrentStep(ONBOARDING_STEP.ROLE);
  };

  /* The three plan-field setters (plan choice, cycle, Free hatch) — the full dirty-wins semantics
   * are in the factory JSDoc in parts.helpers. */
  const { handleStartFree, handleSelectPlan, handleSelectBilling } =
    makePlanFieldSetters(methods);

  // A client who came from a stylist's profile goes back to it (see
  // clientOnboardingHref in StylistProfilePage.composition).
  const returnToStylistProfile = isFromStylistProfile(router.query['from'])
    ? resolvePostLoginTarget(router.query['from'])
    : null;

  /* ─── Success view (terminal) ─── */
  if (showSuccess && isOnboardingRole(role)) {
    return (
      <OnboardingSuccessViewOrganism
        role={role}
        navTitle={navTitle}
        // DECISION: a finished onboarding is not a screen to return to. With `push` it stayed in
        // history, so the dashboard showed "Wróć" and led back into it.
        onEnterApp={() => void router.replace(ROUTES_FRONT.APP)}
        onAddFirstPhoto={() =>
          void router.replace(ROUTES_FRONT.GALLERY_UPLOAD_ASSET)
        }
        onChoosePlan={() => void router.replace(ROUTES_FRONT.USER_ACCOUNT_PAY)}
        offerPaidPlan={
          role === 'stylist' && stylistSuccessOffersPaidPlan(completedPlan)
        }
        returnToStylistProfile={returnToStylistProfile !== null}
        returnToMessage={isFromProfileMessage(router.query['from'])}
        onScanStylist={() =>
          void router.replace(returnToStylistProfile ?? ROUTES_FRONT.PAIRING)
        }
      />
    );
  }

  return (
    // hideBottomNav: a focused flow. hideBackButton: the flow owns its Back
    // (action bar) on CHECKOUT; the avatar/menu trigger keeps the drawer
    // (Wyloguj) reachable, so the funnel is focused, not a trap.
    <AppLayoutComposition
      title={navTitle}
      hideBottomNav
      hideBackButton
      /* The drawer reads the role PICKED in the form, not the session's
         `account_type` (see the `drawerRole` prop in AppLayout). */
      drawerRole={isOnboardingRole(role) ? role : null}>
      <FormProvider {...methods}>
        <div
          className={styles.frame}
          data-fill-shell=''
          data-layout={isCheckoutStep ? 'flow' : 'center'}>
          <form
            className={styles.page}
            onSubmit={e => {
              e.preventDefault();
            }}
            noValidate>
            <div className={styles.shell}>
              <OnboardingProcessHeaderMolecule
                sequence={stepSequenceForRole(role, withCheckout)}
                currentStep={currentStep}
              />

              <section
                key={currentStep}
                {...stepFocusTarget}
                data-step-dir={stepDir}
                className={`${styles.stepCard} ${styles.stepCardEnter}`}>
                {currentStep === ONBOARDING_STEP.ROLE ? (
                  <OnboardingStepRoleOrganism disabled={submitting} />
                ) : null}
                {isCheckoutStep && isOnboardingRole(role) ? (
                  <OnboardingStepCheckoutOrganism
                    planId={selectedPlanId}
                    billingPeriod={billingPeriod}
                    onSelectPlan={handleSelectPlan}
                    onSelectBilling={handleSelectBilling}
                    onSuccess={() =>
                      completeStylist(selectedPlanId, billingPeriod)
                    }
                    onStartFree={handleStartFree}
                    onCheckoutBusyChange={setCheckoutBusy}
                  />
                ) : null}
              </section>

              {/* On CHECKOUT the panel owns its pay CTA; the bar keeps Back. */}
              <OnboardingActionBarMolecule
                currentStep={currentStep}
                isCheckoutStep={isCheckoutStep}
                isFinalStep={stepPosition === totalSteps}
                submitting={submitting}
                checkoutBusy={checkoutBusy}
                onBack={handleBack}
                onNext={handleStart}
                shake={shake}
                onShakeEnd={() => setShake(false)}
              />
            </div>
          </form>
        </div>
      </FormProvider>
    </AppLayoutComposition>
  );
}

/* DECISION: submit fires on leaving ROLE. The stylist account MUST exist before the
   checkout-session endpoint can mint a session, so onboarding completes first, then the embedded
   panel takes over (explicit plan intent) or Free is activated through the same endpoint
   (free-first entry, owner). The success view is a TERMINAL state, not a stepper
   step: the user leaves it on a deliberate press, never an auto-redirect mid-mutation. For the
   stylist its primary action is the first photo, because the profile card (name, city, marketing
   consent) is asked right after it. A confirmed Free completion also offers the pay page and
   "continue on Free Demo"; a paid or trial completion is not labeled Free, and an explicit
   pricing intent still ends on the plan step rather than being forced here (owner). */
