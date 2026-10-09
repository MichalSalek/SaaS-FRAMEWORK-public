// UI/features/auth/components/OnboardingStepPreferences.tsx
//
// Step 3 — smart defaults (N2 Default Effect).
//
// Iter 3: illustrated orb header + toggle row for notifications that gains a
// brand tint when active (CSS :has(input:checked)), plus a quiet summary card
// that defuses commitment anxiety ("everything can be changed later" — the
// preferences are optional / smart-defaulted, so Finish submits them as-is;
// there is no separate skip action).
//
// DECISION (nie usuwaj tego komentarza):
// "Profile visible publicly" toggle was REMOVED in Wave F audit. The toggle
// was rendered but the value was never sent to the backend — StylistAccount
// has no `is_public` / `profile_public` column. Surfacing a control that
// silently no-ops is worse than not having it (false sense of agency). When
// public/private profile gating ships, the control will live in Settings
// with a real backend wire (likely tied to subscription tier).

import { Controller, useFormContext } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { SlidersHorizontalIcon } from '@phosphor-icons/react';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { ToggleAtom } from '../../../components/Toggle/Toggle.atom';
import type { OnboardingFormValues } from '../onboarding.types';
import styles from '../OnboardingPage.module.css';

interface OnboardingStepPreferencesProps {
  /** Active role — passed from the page (not watch()) so the branch stays in
   *  sync under react-compiler, matching the Welcome step. */
  role: OnboardingFormValues['role'];
}

export function OnboardingStepPreferencesOrganism({
  role,
}: OnboardingStepPreferencesProps) {
  const t = useTranslations('pages.onboarding');
  const { control } = useFormContext<OnboardingFormValues>();
  // The default subtitle is stylist-framed ("don't miss new clients"); a client
  // has no clients, so branch to a role-neutral prompt when the client flow runs.
  const isClient = role === 'client';

  return (
    <>
      <div className={styles.stepHeader}>
        <div className={styles.stepHeaderTop}>
          <span className={styles.stepHeaderOrb} aria-hidden='true'>
            <SlidersHorizontalIcon size={26} weight='duotone' />
          </span>
          <TypographyAtom variant='h3' className={styles.stepTitle}>
            {t('preferencesTitle')}
          </TypographyAtom>
        </div>
        <p className={styles.stepSubtitle}>
          {isClient ? t('preferencesSubtitleClient') : t('preferencesSubtitle')}
        </p>
      </div>

      <div className={styles.smartDefaults}>
        {/* Powiadomienia — N2 default ON (wired to backend prefs sync) */}
        <div className={styles.smartDefaultsRow}>
          <Controller
            control={control}
            name='notifications_on'
            render={({ field }) => (
              <ToggleAtom
                label={t('notificationsLabel')}
                checked={field.value}
                onChange={event => field.onChange(event.target.checked)}
              />
            )}
          />
          <span className={styles.smartDefaultsHint}>{t('settingsHint')}</span>
        </div>
      </div>

      <div className={styles.preferencesSummary} aria-hidden='true'>
        <span className={styles.preferencesSummaryIcon}>
          <SlidersHorizontalIcon size={14} weight='fill' />
        </span>
        <span>{t('preferencesSummaryNote')}</span>
      </div>
    </>
  );
}
