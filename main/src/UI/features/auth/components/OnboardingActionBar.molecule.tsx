// UI/features/auth/components/OnboardingActionBar.molecule.tsx
//
// SPE-W4 — the onboarding step navigation bar (extracted from the composition to
// keep it under the 300-line cap). Sticky on mobile, inline on desktop.
//
// Per-step shape:
//   WELCOME      Continue (primary). No Back.
//   ROLE         Back + Continue (Continue disabled until a role is picked).
//   BASIC_INFO   Back + Continue.
//   PREFERENCES  Back + Finish/Continue (isFinalStep: klientka kończy tu —
//                „Zakończ"; stylistka idzie dalej na plan — „Dalej", S76).
//   CHECKOUT     Back + a slot: the plan chooser portals its own CTA into it
//                (ONBOARDING_ACTION_SLOT_ID); the pay stage keeps its CTA in the
//                Stripe form.
//
// DECISION (nie usuwaj tego komentarza):
// Onboarding celowo NIE ma żadnego przycisku „pomiń” (owner: flow ma być zwięzły
// i przejdziony w całości — plan wybierany świadomie na końcu). Wcześniej były
// DWA takie duplikaty: „pomiń wprowadzenie” na WELCOME (robił to co Dalej) oraz
// „pomiń i zakończ” na PREFERENCES (odpalał ten sam submit co Finish) — oba
// usunięte. Sticky footer trzyma tylko rząd Back/Next.

import { useTranslations } from 'next-intl';
import { ArrowLeftIcon, CheckIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { ONBOARDING_STEP } from '../onboarding.types';
import styles from '../OnboardingPage.module.css';

/** DOM id of the checkout-step slot the plan chooser portals its CTA into.
 *  DECISION (nie usuwaj tego komentarza) — owner 2026-09-23: on a 428×723
 *  phone the chooser's CTA sat 2.5 screens below the fold while the sticky
 *  bar showed only "Wstecz", so the last step had no visible way forward. */
export const ONBOARDING_ACTION_SLOT_ID = 'onboarding-action-slot';

interface OnboardingActionBarProps {
  currentStep: number;
  /** A valid role has been picked (gates the role-step Continue). */
  roleSelected: boolean;
  /** Required legal consent has been accepted on the role step. */
  termsAccepted: boolean;
  /** Checkout step — the panel owns the primary CTA; show only Back. */
  isCheckoutStep: boolean;
  /** REALNIE ostatni krok aktywnego flow (rola-zależne: klientka kończy na
   *  preferencjach, stylistka ma po nich jeszcze plan) — steruje labelem
   *  „Zakończ" vs „Dalej" (S76). */
  isFinalStep: boolean;
  submitting: boolean;
  /**
   * Checkout panel busy (paid confirm in flight OR free activation committing).
   * Locks Back so it can never unmount the panel mid-payment/activation (finding
   * #1) — pressing it mid-confirm would drop the Stripe form while confirm() may
   * still create the subscription, leaving the UI back on PREFERENCES.
   */
  checkoutBusy: boolean;
  onBack: () => void;
  onNext: () => void;
  /** One-shot error-shake for the primary Continue/Finish CTA (step invalid or
   *  submit rejected). Parent lifts on true, resets in onShakeEnd. */
  shake: boolean;
  onShakeEnd: () => void;
}

export function OnboardingActionBarMolecule({
  currentStep,
  roleSelected,
  termsAccepted,
  isCheckoutStep,
  isFinalStep,
  submitting,
  checkoutBusy,
  onBack,
  onNext,
  shake,
  onShakeEnd,
}: OnboardingActionBarProps) {
  const t = useTranslations('pages.onboarding');

  const isWelcome = currentStep === ONBOARDING_STEP.WELCOME;
  // Continue stays disabled on the role step until role + required terms are set.
  const nextDisabled =
    !submitting &&
    currentStep === ONBOARDING_STEP.ROLE &&
    (!roleSelected || !termsAccepted);

  return (
    <div className={styles.actionBar}>
      <div className={styles.actionBarRow}>
        {!isWelcome ? (
          <ButtonAtom
            type='button'
            variant='ghost'
            size='lg'
            icon={<ArrowLeftIcon size={18} />}
            onClick={onBack}
            disabled={submitting || checkoutBusy}
            className={styles.actionBarBack}
            // Checkout: icon-only, so the portaled CTA (longest label of the
            // funnel) keeps one line on a 360px phone.
            {...(isCheckoutStep ? { ariaLabel: t('back') } : {})}>
            {isCheckoutStep ? undefined : t('back')}
          </ButtonAtom>
        ) : null}

        {isCheckoutStep ? (
          <div
            id={ONBOARDING_ACTION_SLOT_ID}
            className={styles.actionBarSlot}
          />
        ) : null}
        {!isCheckoutStep ? (
          <ButtonAtom
            type='button'
            variant='primary'
            size='lg'
            icon={
              isFinalStep ? <CheckIcon size={18} weight='fill' /> : undefined
            }
            direction={isFinalStep ? undefined : 'forward'}
            onClick={onNext}
            disabled={nextDisabled}
            loading={submitting}
            shake={shake}
            onShakeEnd={onShakeEnd}
            className={`${styles.actionBarNext} haptic-press`}>
            {submitting ? t('saving') : isFinalStep ? t('finish') : t('next')}
          </ButtonAtom>
        ) : null}
      </div>
    </div>
  );
}
