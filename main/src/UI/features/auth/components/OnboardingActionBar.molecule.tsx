// UI/features/auth/components/OnboardingActionBar.molecule.tsx
// The onboarding navigation bar (extracted from the composition to keep it under the 300-line cap).
// Sticky on mobile, inline on desktop. Per-step shape:
//   ROLE      Start (primary; „Zaczynam” when it is the last step, „Dalej” before the plan step)
//             + the terms line under it. No Back: it is the first screen. The button stays enabled:
//             without a role it shakes and the error appears under the cards (the bar carries no
//             status line, so both cards fit on a 695px iPhone screen).
//   CHECKOUT  Back + a slot: the plan chooser portals its own CTA into it
//             (ONBOARDING_ACTION_SLOT_ID); the pay stage keeps its CTA in the Stripe form.
//
// DECISION: onboarding has NO "skip" button (the flow must stay short). Terms + 16+ are accepted by
// pressing the start button, stated in one line right under it; consent checkboxes looked like
// buttons and a production stylist toggled them seven times before moving on. The line sits next to
// the button it speaks about, never above the role cards. (owner)

import { useTranslations } from 'next-intl';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { legalLinkChunks } from '../../shared/legal/legal-link-chunks.helpers';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { ONBOARDING_STEP } from '../onboarding.types';
import styles from '../OnboardingPage.module.css';

/** DOM id of the checkout-step slot the plan chooser portals its CTA into.
 * DECISION: on a 428x723 phone the plan chooser's CTA sat 2.5 screens below the fold while the
 * sticky bar showed only "Wstecz", so the last step had no visible way forward; the CTA portals
 * into this slot. (owner) */
export const ONBOARDING_ACTION_SLOT_ID = 'onboarding-action-slot';

interface OnboardingActionBarProps {
  currentStep: number;
  /** Checkout step — the panel owns the primary CTA; show only Back. */
  isCheckoutStep: boolean;
  /** The role step is the last one (no plan intent): „Zaczynam”. */
  isFinalStep: boolean;
  submitting: boolean;
  /** Checkout panel busy: locks Back so it can never unmount the panel
   *  mid-payment/activation. */
  checkoutBusy: boolean;
  onBack: () => void;
  onNext: () => void;
  /** One-shot error-shake for the primary CTA. */
  shake: boolean;
  onShakeEnd: () => void;
}

export function OnboardingActionBarMolecule({
  currentStep,
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

  const isRoleStep = currentStep === ONBOARDING_STEP.ROLE;

  return (
    <div className={styles.actionBar}>
      <div className={styles.actionBarRow}>
        {!isRoleStep ? (
          <ButtonAtom
            type='button'
            variant='ghost'
            size='lg'
            icon={<ArrowLeftIcon size={18} />}
            onClick={onBack}
            disabled={submitting || checkoutBusy}
            className={styles.actionBarBack}
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
            direction='forward'
            onClick={onNext}
            loading={submitting}
            shake={shake}
            onShakeEnd={onShakeEnd}
            className={`${styles.actionBarNext} press-feedback`}>
            {submitting ? t('saving') : isFinalStep ? t('start') : t('next')}
          </ButtonAtom>
        ) : null}
      </div>
      {isRoleStep ? (
        <p className={styles.termsNotice}>
          {t.rich('termsNotice', legalLinkChunks(styles.termsNoticeLink))}
        </p>
      ) : null}
    </div>
  );
}
