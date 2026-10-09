// UI/features/auth/OnboardingPage.composition.tsx
// Multi-step onboarding — SPE-W4 (5-step flow + success view).
// Header: intro card on WELCOME, the shared process header on every later step.
//
// Flow (role-dependent — driven by stepSequenceForRole, NOT contiguous ±1):
//   stylist: WELCOME → ROLE → BASIC_INFO → PREFERENCES [→ CHECKOUT] (4-5 steps;
//            CHECKOUT only with an explicit plan intent, useOnboardingFreeStart)
//   client : WELCOME → ROLE → PREFERENCES                          (3 steps)
//   1 WELCOME      value-prop + risk-reduction (soft-skip, no data)
//   2 ROLE         role + RODO consents
//   3 BASIC_INFO   display name / city / phone — STYLIST ONLY (clients skip it:
//                  no ClientAccount columns → data would be silently dropped)
//   4 PREFERENCES  smart defaults — last DATA step (submit happens here)
//   5 CHECKOUT     stylist only — embedded plan choice + payment (W2 panel)
//   → SUCCESS      terminal "all set" view → user pushes to /app
//
// Submit timing: the ONBOARD_AS_* mutation fires on leaving PREFERENCES.
//   - client : submit → success view (no payment surface).
//   - stylist: submit → with a plan intent: advance to CHECKOUT (the account
//              must exist before the checkout-session endpoint can mint a
//              session) → panel onSuccess → success view; without one: Free is
//              activated in place → success view (chooser only as fallback).
//
// Stack: react-hook-form FormProvider + TanStack Query mutation + CSS Modules.
// Psychology: N1 (Possessive Language), N2 (Default Effect),
//             N6 (Endowed Progress), N3 (Soft skip / no penalty).

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { usePricingFunnelState } from '../../shared/hooks/usePricingFunnelState';
import { OnboardingHeroOrganism } from './components/OnboardingHero.organism';
import { OnboardingProcessHeaderMolecule } from './components/OnboardingProcessHeader.molecule';
import { OnboardingStepWelcomeOrganism } from './components/OnboardingStepWelcome.organism';
import { OnboardingStepRoleOrganism } from './components/OnboardingStepRole.organism';
import { OnboardingStepBasicInfoOrganism } from './components/OnboardingStepBasicInfo.organism';
import { OnboardingStepPreferencesOrganism } from './components/OnboardingStepPreferences.organism';
import { OnboardingStepCheckoutOrganism } from './components/OnboardingStepCheckout.organism';
import { OnboardingSuccessViewOrganism } from './components/OnboardingSuccessView.organism';
import { OnboardingActionBarMolecule } from './components/OnboardingActionBar.molecule';
import { useCompleteOnboarding } from './hooks/useCompleteOnboarding';
import {
  clearOnboardingDraft,
  useOnboardingDraft,
} from './hooks/useOnboardingDraft';
import { useOnboardingRolePrefill } from './hooks/useOnboardingRolePrefill';
import { useOnboardingFreeStart } from './hooks/useOnboardingFreeStart';
import { useStepScrollReset } from './hooks/useStepScrollReset';
import {
  ONBOARDING_DEFAULTS,
  ONBOARDING_STEP,
  type OnboardingFormValues,
} from './onboarding.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import {
  isOnboardingRole,
  readPrefilledRole,
  fieldsForStep,
  selectsPlan,
  totalStepsForRole,
  stepSequenceForRole,
  stepPositionForRole,
  nextStep,
  prevStep,
} from './onboarding.helpers';
import {
  makePlanFieldSetters,
  welcomeHeroCopy,
  onboardingNavTitle,
  focusFirstError,
  syncNotificationPreferenceIfChanged,
  ensureOnboardingConsent,
  advanceOnEnterKey,
  stylistOnboardPayload,
  clientOnboardPayload,
  stylistPayloadKey,
} from './OnboardingPage.parts.helpers';
import { captureOnboardingCompleted } from '../../../application/analytics/onboarding-events';
import styles from './OnboardingPage.module.css';

/* ─── Component ─── */

export function OnboardingPageComposition() {
  const t = useTranslations('pages.onboarding');
  const router = useRouter();
  const { clearPricingFunnel } = usePricingFunnelState();

  const prefilledRole = useMemo(
    () => readPrefilledRole(router.query),
    [router.query]
  );

  const methods = useForm<OnboardingFormValues>({
    mode: 'onBlur',
    defaultValues: {
      ...ONBOARDING_DEFAULTS,
      role: prefilledRole ?? ONBOARDING_DEFAULTS.role,
    },
  });

  // `?role=` → lejek cennika → posiadane konto; wyłącznie pola nietknięte
  // (kolejność źródeł i DECISION o wyścigu hydracji w hooku).
  useOnboardingRolePrefill(methods, prefilledRole);

  const [currentStep, setCurrentStep] = useState<number>(
    ONBOARDING_STEP.WELCOME
  );
  const [showSuccess, setShowSuccess] = useState(false);
  // Szkic w pamięci sesji (pełne uzasadnienie w useOnboardingDraft). Hook stoi
  // PO efektach prefillu — odtwarza pola jako dirty, a tamte ruszają wyłącznie
  // nietknięte, więc szkic wygrywa.
  useOnboardingDraft({
    methods,
    currentStep,
    onRestoreStep: setCurrentStep,
    showSuccess,
  });
  // Set once the ONBOARD_AS_* mutation has created the account: a stylist who
  // steps Back from CHECKOUT re-advances WITHOUT a second (idempotent) mutation.
  // Holds the key of the payload that created the account (stylistPayloadKey):
  // an edit made after Back changes the key, so the mutation runs again and
  // the edit is saved instead of silently dropped (review 2026-09-23).
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  // Direction of the last step transition, exposed to CSS via `data-step-dir`
  // on the step card so the enter animation slides X-axis the native way:
  // forward = new step rides in from the right, back = from the left.
  const [stepDir, setStepDir] = useState<'forward' | 'back'>('forward');
  // Finding #1: the checkout panel bubbles a "busy" flag (paid confirm in flight
  // OR a free activation committing). While busy, the sticky global Back is
  // locked so it can never unmount the panel mid-payment/activation.
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  // One-shot error-shake for the Continue/Finish CTA — fires when a step's
  // validation blocks the advance OR the onboard mutation is rejected.
  const [shake, setShake] = useState(false);
  const { mutate, isPending } = useCompleteOnboarding();
  /** Stylist finished (plan resolved: paid, trial or Free) → success view.
   *  Event końca onboardingu — semantyka w JSDoc helpera. */
  const completeStylist = (
    planId: PricingPlan | null,
    period: BillingPeriod
  ) => {
    captureOnboardingCompleted('stylist', planId, period);
    clearPricingFunnel();
    // Ukończony onboarding nie może odtwarzać lejka przy kolejnym wejściu.
    clearOnboardingDraft();
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
  // Synchronous submit re-entry guard. `isPending` lags a render behind a rapid
  // double-tap on "Continue" (the CTA's onClick → handleSubmit validation is
  // async), so it cannot stop the second mutate() from firing in the same burst.
  // This ref closes that window the instant the first submit is dispatched.
  // Mirror of CheckoutForm.molecule's confirmingRef. The backend onboard mutation
  // is idempotent (find-or-create), so a duplicate POST is harmless but wasteful —
  // the guard removes it. Cleared on error so a retry after a failed submit works.
  const submitInFlightRef = useRef(false);

  // scroll-reset-allow: reset lives in hooks/useStepScrollReset (moved out for the 300-line cap).
  // It also rescues focus lost by a step change onto the step card it returns.
  const stepFocusTarget = useStepScrollReset(currentStep, showSuccess);

  // Top-bar title: WELCOME keeps its intro card, so its title appears in the bar
  // only once the card scrolls out of view (useReportHeroVisibility in the
  // card); from the second step the bar carries the name of the process and
  // the step indicator carries the step (DECISION in ProcessHeaderMolecule).
  // Passed to useAppBarTitle AND as the AppLayout `title` prop (the
  // pre-hydration fallback) so no stale constant flashes before the effect runs.
  const navTitle = onboardingNavTitle(currentStep, showSuccess, t);
  useAppBarTitle(navTitle);

  const role = methods.watch('role');
  const termsAccepted = methods.watch('terms_accepted');
  const selectedPlanId = methods.watch('selected_plan_id');
  const billingPeriod = methods.watch('billing_period');
  const totalSteps = totalStepsForRole(role, withCheckout);
  // Display position (contiguous 1..N) — differs from currentStep id for clients
  // who skip BASIC_INFO; decides which step is the flow's last one.
  const stepPosition = stepPositionForRole(currentStep, role, withCheckout);
  const submitting = isPending || isActivating;

  /* ── Submit the onboarding mutation (creates the account) ── */
  const submitOnboarding = (
    values: OnboardingFormValues,
    onDone: () => void
  ) => {
    // Shared for both role branches. Both callbacks RELEASE the synchronous
    // re-entry guard: its only job is to close the double-tap window before
    // isPending flips, and the mutation has settled by the time either fires.
    // Leaving it latched on success was a silent dead-end — PREFERENCES IS
    // re-reachable via Back + a role switch (e.g. stylist finishes → Back →
    // picks client → Finish), and a stale latch made that Finish a no-op with
    // zero feedback. onSuccess also persists the notification preference
    // (non-blocking) + advances; onError only shakes the CTA: the toast belongs
    // to the interceptor or the hook (one toast per failure).
    const callbacks = {
      onSuccess: () => {
        submitInFlightRef.current = false;
        syncNotificationPreferenceIfChanged(values.notifications_on);
        onDone();
      },
      onError: () => {
        submitInFlightRef.current = false;
        setShake(true);
      },
    };

    if (values.role === 'stylist') {
      mutate(stylistOnboardPayload(values), callbacks);
      return;
    }

    mutate(clientOnboardPayload(values), callbacks);
  };

  /** Defense-in-depth consent replay (ekstrakt: ensureOnboardingConsent w
   *  parts.helpers — terms_accepted niesie też deklarację 16+). */
  const backToRoleStep = () => setCurrentStep(ONBOARDING_STEP.ROLE);

  /** Leaving PREFERENCES = submit. Client → success; stylist → advanceStylist. */
  const finishDataSteps = methods.handleSubmit(
    values => {
      if (!ensureOnboardingConsent(values, t, backToRoleStep)) {
        return;
      }
      // Re-entry after Back from CHECKOUT: the account already exists — skip the
      // onboard mutation and just re-advance the stylist to the payment step. Still
      // sync the notification preference: a toggle changed on this Back-visit would
      // otherwise be dropped (the mutation that normally persists it is skipped).
      // Non-blocking + idempotent, so it does not gate the advance nor need the ref.
      if (
        submittedKey === stylistPayloadKey(values) &&
        selectsPlan(values.role)
      ) {
        syncNotificationPreferenceIfChanged(values.notifications_on);
        advanceStylist();
        return;
      }
      // Synchronous double-fire guard: bail if a submit is already dispatched (a
      // rapid double-tap reaches here twice before `isPending` flips). Cleared in
      // submitOnboarding's callbacks on BOTH success and error, so a legitimate
      // re-submit after Back (e.g. a role switch that re-reaches PREFERENCES) is
      // never silently swallowed.
      if (submitInFlightRef.current) {
        return;
      }
      submitInFlightRef.current = true;
      submitOnboarding(values, () => {
        setSubmittedKey(stylistPayloadKey(values));
        if (selectsPlan(values.role)) {
          advanceStylist();
        } else {
          // Client: no payment surface — straight to the success view.
          // Koniec onboardingu klientki = ten submit (funnel D0; stylistka
          // kończy w completeStylist).
          captureOnboardingCompleted('client');
          clearPricingFunnel();
          clearOnboardingDraft();
          setShowSuccess(true);
        }
      });
    },
    () => setShake(true)
  );

  const handleNext = async () => {
    if (currentStep === ONBOARDING_STEP.PREFERENCES) {
      await finishDataSteps();
      return;
    }
    const fields = fieldsForStep(currentStep, role);
    if (!(await methods.trigger(fields))) {
      focusFirstError(methods, fields);
      setShake(true);
      return;
    }
    setStepDir('forward');
    setCurrentStep(step => nextStep(step, role, withCheckout));
  };

  const handleBack = () => {
    setStepDir('back');
    setCurrentStep(step => prevStep(step, role, withCheckout));
  };

  /* Trzy settery pól planu (wybór planu, cykl, furtka Free) — pełna semantyka
   * dirty-wins w JSDoc fabryki w parts.helpers. */
  const { handleStartFree, handleSelectPlan, handleSelectBilling } =
    makePlanFieldSetters(methods);

  // Bare /app is the right target on EVERY device: on mobile/app it is the
  // product dashboard; on desktop ≥1280 (PREVIEW/PROD) useDesktopRedirectGuard
  // re-routes a logged-in user from /app to /app/user/account (owner
  // 2026-07-10, DECISION in resolveDesktopBounceDecision) — no desktop
  // special-case needed here.
  const enterApp = () => {
    void router.push(ROUTES_FRONT.APP);
  };

  /* ─── Success view (terminal) ─── */
  if (showSuccess && isOnboardingRole(role)) {
    return (
      <OnboardingSuccessViewOrganism
        role={role}
        navTitle={navTitle}
        onEnterApp={enterApp}
      />
    );
  }

  /* ─── Header: intro card on WELCOME, shared process header after it ─── */
  const isWelcomeStep = currentStep === ONBOARDING_STEP.WELCOME;
  const hero = welcomeHeroCopy(role, t);
  const isCheckoutStep = currentStep === ONBOARDING_STEP.CHECKOUT;

  return (
    // hideBottomNav: onboarding is a focused linear flow — the bottom tab bar
    // would invite escape mid-funnel before the required role/profile data is
    // captured (N6 endowed-progress). title is also set dynamically via
    // useAppBarTitle above; the static prop is the SSR/no-JS fallback.
    // hideBackButton: the flow owns its own step-back (ActionBar "Wstecz"); the
    // app-shell router-back would be a SECOND, differently scoped "wstecz" next
    // to it and would rewind past the finished flow on the success view. Hidden
    // → the avatar/menu trigger takes the slot, so escape stays available via the
    // drawer (Wyloguj) — the funnel is focused, not a trap (owner 2026-07-12).
    <AppLayoutComposition
      title={navTitle}
      hideBottomNav
      hideBackButton
      /* Szuflada czyta rolę WYBRANĄ w formularzu, nie `account_type` z sesji
         (uzasadnienie przy propie `drawerRole` w AppLayout). Przed wyborem roli
         leci `null`: szuflada nie pokazuje wtedy menu klientki z domyślnego
         CLIENT, tylko samo wyjście. */
      drawerRole={isOnboardingRole(role) ? role : null}>
      <FormProvider {...methods}>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- DECISION: delegated Enter from the text fields inside (advanceOnEnterKey); the form itself gets no role or focus. */}
        <form
          className={styles.page}
          data-fill-shell=''
          onSubmit={e => {
            e.preventDefault();
          }}
          onKeyDown={e => {
            // Checkout owns its payment submit (DECISION in advanceOnEnterKey).
            if (!isCheckoutStep && !submitting) {
              advanceOnEnterKey(e, () => void handleNext());
            }
          }}
          noValidate>
          {/* ─── WELCOME keeps its intro card (DECISION in the component, where
              useReportHeroVisibility also runs INSIDE the AppLayout provider
              subtree). Every later step starts with the process header. ─── */}
          {isWelcomeStep ? (
            <OnboardingHeroOrganism
              title={hero.title}
              accent={hero.accent}
              subtitle={hero.subtitle}
            />
          ) : null}

          <div className={styles.shell}>
            <OnboardingProcessHeaderMolecule
              sequence={stepSequenceForRole(role, withCheckout)}
              currentStep={currentStep}
              withIndicator={!isWelcomeStep}
            />

            {/* ─── STEP CARD — focused single decision per screen ─── */}
            <section
              key={currentStep}
              {...stepFocusTarget}
              data-step-dir={stepDir}
              className={`${styles.stepCard} ${styles.stepCardEnter}`}>
              {currentStep === ONBOARDING_STEP.WELCOME ? (
                <OnboardingStepWelcomeOrganism role={role} />
              ) : null}
              {currentStep === ONBOARDING_STEP.ROLE ? (
                <OnboardingStepRoleOrganism
                  prefilled={prefilledRole !== null}
                />
              ) : null}
              {currentStep === ONBOARDING_STEP.BASIC_INFO ? (
                <OnboardingStepBasicInfoOrganism />
              ) : null}
              {currentStep === ONBOARDING_STEP.PREFERENCES ? (
                <OnboardingStepPreferencesOrganism role={role} />
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

            {/* ─── ACTION BAR — sticky on mobile, inline on desktop ─── */}
            {/* On CHECKOUT the panel owns its own pay/cancel CTAs, so we drop
                the primary action and keep only a quiet Back affordance. */}
            <OnboardingActionBarMolecule
              currentStep={currentStep}
              roleSelected={isOnboardingRole(role)}
              termsAccepted={termsAccepted}
              isCheckoutStep={isCheckoutStep}
              /* S76: „Zakończ" tylko na realnie ostatnim kroku flow roli
                 (stylistka z intencją planu ma po preferencjach jeszcze plan
                 → „Dalej"; bez intencji preferencje kończą flow). */
              isFinalStep={stepPosition === totalSteps}
              submitting={submitting}
              checkoutBusy={checkoutBusy}
              onBack={handleBack}
              onNext={() => void handleNext()}
              shake={shake}
              onShakeEnd={() => setShake(false)}
            />
          </div>
        </form>
      </FormProvider>
    </AppLayoutComposition>
  );
}

/* DECISION (nie usuwaj tego komentarza):
 * - Header (vote `s126-proces`, owner 2026-10-09): the WELCOME step keeps its
 *   intro card; every later step starts with the shared ProcessHeaderMolecule
 *   („Pasek i jedna linia”), which replaced the orb stepper and the step pill.
 *   WELCOME still counts as step 1, so the indicator's first appearance reads
 *   „Krok 2 z N” with two segments filled.
 * - Submit fires on leaving PREFERENCES (not on the checkout step). The stylist
 *   account MUST exist before the checkout-session endpoint can mint a session,
 *   so onboarding completes first, then the embedded panel takes over (explicit
 *   plan intent) or Free is activated through the same endpoint (free-first
 *   entry, owner 2026-09-23, DOMAIN_SSOT §18). Clients
 *   have no payment surface, so for them PREFERENCES is the last step and submit
 *   goes straight to the success view.
 * - The success view is a TERMINAL state, not a stepper step — the user reaches
 *   the app on a deliberate CTA press, never an auto-redirect mid-mutation.
 */
