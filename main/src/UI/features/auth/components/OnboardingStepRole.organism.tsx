// UI/features/auth/components/OnboardingStepRole.organism.tsx
//
// The whole onboarding for most people: one sentence of welcome and the two
// role cards (owner: role-only onboarding, the welcome shortened to
// one sentence above the cards; DECISION in onboarding.types.ts).
//
// Terms + 16+ are accepted by the start button, stated under it in the action
// bar. Optional marketing opt-in starts here and can be offered again after
// the first photo when the stylist has not enabled it yet.

import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import {
  ScissorsIcon,
  HeartIcon,
  CheckIcon,
  HandWavingIcon,
} from '@phosphor-icons/react';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { CheckboxAtom } from '../../../components/Checkbox/Checkbox.atom';
import type { OnboardingFormValues, OnboardingRole } from '../onboarding.types';
import styles from '../OnboardingPage.module.css';

interface OnboardingStepRoleProps {
  disabled?: boolean;
}

export function OnboardingStepRoleOrganism({
  disabled = false,
}: OnboardingStepRoleProps) {
  const t = useTranslations('pages.onboarding');
  const { control } = useFormContext<OnboardingFormValues>();
  const role = useWatch({ control, name: 'role' });

  return (
    <>
      <div className={styles.stepHeader}>
        <div className={styles.stepHeaderTop}>
          <span className={styles.stepHeaderOrb} aria-hidden='true'>
            <HandWavingIcon size={26} weight='duotone' />
          </span>
          <TypographyAtom variant='h3' className={styles.stepTitle}>
            {t('roleWelcomeTitle')}
          </TypographyAtom>
        </div>
        <p className={styles.stepSubtitle}>{t('roleWelcomeSubtitle')}</p>
      </div>

      <Controller
        control={control}
        name='role'
        rules={{ required: t('roleRequired') }}
        render={({ field, fieldState }) => (
          <div
            role='radiogroup'
            aria-label={t('roleAriaLabel')}
            className={styles.roleCards}>
            <RoleCard
              roleValue='stylist'
              icon={<ScissorsIcon size={28} weight='duotone' />}
              title={t('stylistRoleTitle')}
              description={t('stylistRoleDesc')}
              selected={field.value === 'stylist'}
              disabled={disabled}
              onSelect={() => field.onChange('stylist')}
            />
            <RoleCard
              roleValue='client'
              icon={<HeartIcon size={28} weight='duotone' />}
              title={t('clientRoleTitle')}
              description={t('clientRoleDesc')}
              selected={field.value === 'client'}
              disabled={disabled}
              onSelect={() => field.onChange('client')}
            />
            {fieldState.error?.message ? (
              <span className={styles.fieldError} role='alert'>
                {fieldState.error.message}
              </span>
            ) : null}
          </div>
        )}
      />
      {role === 'stylist' && (
        <Controller
          control={control}
          name='email_marketing'
          render={({ field }) => (
            <CheckboxAtom
              className={styles.marketingConsent}
              name={field.name}
              label={t('marketingConsentLabel')}
              checked={field.value}
              onChange={event => field.onChange(event.target.checked)}
              onBlur={field.onBlur}
              disabled={disabled}
            />
          )}
        />
      )}
    </>
  );
}

/* ─── Internal: single role card (radio button styled as card) ─── */

interface RoleCardProps {
  // Named `roleValue` (not `role`) so it is unambiguously a domain prop, not an
  // ARIA role attribute — avoids jsx-a11y/aria-role false positives at call sites.
  roleValue: OnboardingRole;
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}

function RoleCard({
  roleValue,
  icon,
  title,
  description,
  selected,
  onSelect,
  disabled,
}: RoleCardProps) {
  return (
    <button
      type='button'
      disabled={disabled}
      role='radio'
      aria-checked={selected}
      data-role={roleValue}
      className={`${styles.roleCard} ${
        selected ? styles.roleCardSelected : ''
      } press-feedback`}
      onClick={onSelect}>
      {selected ? (
        <CheckIcon
          className={styles.roleCardCheck}
          weight='bold'
          aria-hidden='true'
        />
      ) : null}
      <span className={styles.roleCardIconWrap} aria-hidden='true'>
        {icon}
      </span>
      <h3 className={styles.roleCardTitle}>{title}</h3>
      <p className={styles.roleCardDescription}>{description}</p>
    </button>
  );
}
