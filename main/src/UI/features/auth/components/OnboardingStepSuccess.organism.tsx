// UI/features/auth/components/OnboardingStepSuccess.organism.tsx
//
// SPE-W4 — the terminal "all set" view, shown after onboarding completes
// (client) or after the plan is selected / paid (stylist). NOT a numbered step
// in the stepper — a closing celebration that hands the user into the app with a
// single confident CTA. Warm, mentoring tone: "your studio is ready".
//
// DECISION (nie usuwaj tego komentarza):
// Success owns the navigation moment — the composition flips into this view on a
// successful submit/plan-selection and only THEN does the user push to /app (no
// auto-redirect, no silent bounce), so the journey closes on a deliberate beat
// rather than a flash of the dashboard mid-mutation.

import { useTranslations } from 'next-intl';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import type { OnboardingRole } from '../onboarding.types';
import { ONBOARDING_FOCUS_TARGET_ID } from '../hooks/useStepScrollReset';
import styles from '../OnboardingPage.module.css';

interface OnboardingStepSuccessProps {
  role: OnboardingRole;
  /** Enter the app — owned by the composition (router.push). */
  onEnterApp: () => void;
}

export function OnboardingStepSuccessOrganism({
  role,
  onEnterApp,
}: OnboardingStepSuccessProps) {
  const t = useTranslations('pages.onboarding');

  const body =
    role === 'stylist' ? t('successBodyStylist') : t('successBodyClient');

  return (
    <div
      className={styles.successCard}
      id={ONBOARDING_FOCUS_TARGET_ID}
      tabIndex={-1}>
      <span className={styles.successMark} aria-hidden='true'>
        <CheckCircleIcon size={56} weight='duotone' />
      </span>
      <TypographyAtom variant='h2' className={styles.successTitle}>
        {t('successTitle')}
      </TypographyAtom>
      <p className={styles.successBody}>{body}</p>
      <ButtonAtom
        type='button'
        direction='forward'
        variant='primary'
        size='lg'
        onClick={onEnterApp}
        className={`${styles.successCta} haptic-press`}>
        {t('successCta')}
      </ButtonAtom>
    </div>
  );
}
