// UI/features/auth/components/OnboardingStepSuccess.organism.tsx
//
// SPE-W4 — the terminal "all set" view, shown after onboarding completes
// (client) or after the plan is selected / paid (stylist). NOT a numbered step
// in the stepper — a closing celebration that hands the user into the app with a
// single confident CTA. Warm, mentoring tone: "your studio is ready".
//
// DECISION: Success owns the navigation moment. The composition flips into this view on a
// successful submit/plan selection and only THEN does the user push to /app (no auto-redirect, no
// silent bounce), so the journey closes on a deliberate beat rather than a flash of the dashboard
// mid-mutation.

import { useTranslations } from 'next-intl';
import { PlusIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { SuccessSceneOrganism } from '../../../components/OutcomeFeedback/SuccessScene.organism';
import { PRICING_LIMITS_SSOT } from '@kernel/policies/pricing.policy';
import type { OnboardingRole } from '../onboarding.types';
import { ONBOARDING_FOCUS_TARGET_ID } from '../hooks/useStepScrollReset';
import styles from '../OnboardingPage.module.css';

interface OnboardingStepSuccessProps {
  role: OnboardingRole;
  /** Enter the app — owned by the composition (router.push). */
  onEnterApp: () => void;
  /** Stylist: open the upload flow for her first photo. */
  onAddFirstPhoto: () => void;
  /** Stylist whose confirmed plan is Free: open the pay page. */
  onChoosePlan: () => void;
  /** True only for a confirmed Free completion. Paid and trial stay unlabeled. */
  offerPaidPlan: boolean;
  /** Client: open the QR scan, the one step that unlocks the product. */
  onScanStylist: () => void;
  /** Client who came from a stylist's profile: the primary action leads back
   *  to it (the pairing request is made there), not to the QR scan. */
  returnToStylistProfile: boolean;
  /** The profile return opens a free conversation rather than requesting a connection. */
  returnToMessage?: boolean;
}

export function OnboardingStepSuccessOrganism({
  role,
  onEnterApp,
  onAddFirstPhoto,
  onChoosePlan,
  offerPaidPlan,
  onScanStylist,
  returnToStylistProfile,
  returnToMessage = false,
}: OnboardingStepSuccessProps) {
  const t = useTranslations('pages.onboarding');

  const body =
    role === 'stylist' ? (
      <>
        <p>{t('successBodyStylist')}</p>
        {offerPaidPlan && (
          <p className={styles.successFreeStatus}>
            {t('successFreeStatus', {
              photos: PRICING_LIMITS_SSOT.FREE.max_gallery_records,
              clients: PRICING_LIMITS_SSOT.FREE.max_paired_clients,
            })}
          </p>
        )}
      </>
    ) : returnToMessage ? (
      t('successBodyMessage')
    ) : (
      t('successBodyClient')
    );

  return (
    <div
      id={ONBOARDING_FOCUS_TARGET_ID}
      tabIndex={-1}
      className={`${styles.focusTarget} ${styles.successFocusTarget}`}>
      <SuccessSceneOrganism
        presentation='glory'
        actionDock
        title={t('successTitle')}
        body={body}
        actions={
          role === 'stylist' ? (
            <div className={styles.successActions}>
              <ButtonAtom
                type='button'
                variant='primary'
                size='lg'
                icon={<PlusIcon size={18} weight='bold' />}
                onClick={onAddFirstPhoto}
                className={`${styles.successCta} press-feedback`}>
                {t('successCtaStylist')}
              </ButtonAtom>
              {offerPaidPlan ? (
                <ButtonAtom
                  type='button'
                  variant='outlined'
                  size='lg'
                  onClick={onChoosePlan}
                  className={`${styles.successCta} press-feedback`}>
                  {t('successChoosePlan')}
                </ButtonAtom>
              ) : null}
              <ButtonAtom
                type='button'
                variant='text'
                size='md'
                onClick={onEnterApp}
                className={styles.successCta}>
                {offerPaidPlan ? t('successContinueFree') : t('successCta')}
              </ButtonAtom>
            </div>
          ) : (
            // A client without a stylist sees nothing in the app yet, so the
            // scan is the primary action here, mirroring the stylist's photo.
            // No plan action: a client has no billing surface.
            <div className={styles.successActions}>
              <ButtonAtom
                type='button'
                direction='forward'
                variant='primary'
                size='lg'
                onClick={onScanStylist}
                className={`${styles.successCta} press-feedback`}>
                {returnToMessage
                  ? t('successCtaClientMessage')
                  : returnToStylistProfile
                    ? t('successCtaClientProfile')
                    : t('successCtaClient')}
              </ButtonAtom>
              <ButtonAtom
                type='button'
                variant='text'
                size='md'
                onClick={onEnterApp}
                className={styles.successCta}>
                {t('successCta')}
              </ButtonAtom>
            </div>
          )
        }
      />
    </div>
  );
}
