// UI/features/auth/components/OnboardingStepRole.tsx
//
// Step 1 — role selection (stylist / client) + RODO Art. 6(1)(a) explicit
// ToS + privacy acceptance (with the age-16 declaration merged into one row)
// + optional marketing opt-in (stylist-only).
//
// Iter 3: two side-by-side role cards (single column <520px) with subtle
// hover lift, a brand-tinted halo when selected, and an inline check dot
// in the top-right corner of the chosen card. The terms + marketing rows
// use a dashed border to feel quietly compliant rather than legalistic.
//
// DECISION (nie usuwaj tego komentarza):
// Terms acceptance is enforced here (Step 1) rather than at submit because:
//  (a) RODO requires consent BEFORE data processing starts — by Step 2 we're
//      already collecting display_name + city, which is processing.
//  (b) Step 1 is the "identity & consent gate" — role + terms (terms now also
//      carries the age-16 declaration, merged into one row) form a coherent
//      legal block; Step 2 onwards is "filling in your card".
//  (c) Localized strings re-use `pages.onboarding.client.*` namespace whose
//      content is role-agnostic (identical for stylist + client); avoiding
//      a duplicate top-level key set keeps the i18n surface small.
//
// DECISION (nie usuwaj tego komentarza):
// The marketing opt-in renders ONLY for role === 'stylist'. Marketing email
// (email_marketing) exists exclusively on StylistAccount — clients receive no
// marketing lifecycle (it is stylist-centric); per-person client consent lives
// separately in NewsletterSubscriber. Showing the checkbox to a client would be
// misleading (a consent we cannot act on), so it is stylist-only. "Select all"
// only spans the consents actually visible for the chosen role.

import { AppLinkAtom as Link } from '../../../components/AppLink/AppLink.atom';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import {
  ScissorsIcon,
  HeartIcon,
  CheckIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { CheckboxAtom } from '../../../components/Checkbox/Checkbox.atom';
import type { OnboardingFormValues, OnboardingRole } from '../onboarding.types';
import styles from '../OnboardingPage.module.css';

interface OnboardingStepRoleProps {
  /** When provided, the step shows a contextual hint that the role
   *  was carried over from registration and can still be changed. */
  prefilled?: boolean;
}

export function OnboardingStepRoleOrganism({
  prefilled = false,
}: OnboardingStepRoleProps) {
  const t = useTranslations('pages.onboarding');
  const { control, setValue } = useFormContext<OnboardingFormValues>();

  // Live consent state drives the marketing visibility (stylist-only) and the
  // derived "select all" checkbox — no separate state to drift out of sync.
  const selectedRole = useWatch<OnboardingFormValues, 'role'>({
    control,
    name: 'role',
  });
  const termsAccepted = useWatch<OnboardingFormValues, 'terms_accepted'>({
    control,
    name: 'terms_accepted',
  });
  const marketingConsent = useWatch<OnboardingFormValues, 'marketing_consent'>({
    control,
    name: 'marketing_consent',
  });

  const showConsentForm = selectedRole !== '';
  const showMarketing = selectedRole === 'stylist';

  // "Select all" is fully derived from the visible consents: ticked only when
  // every visible consent is ticked. Toggling sets/clears all visible consents.
  const allConsentsChecked = showMarketing
    ? Boolean(termsAccepted && marketingConsent)
    : Boolean(termsAccepted);

  const handleSelectAll = (checked: boolean) => {
    setValue('terms_accepted', checked, {
      shouldValidate: true,
      shouldDirty: true,
    });
    if (showMarketing) {
      setValue('marketing_consent', checked, { shouldDirty: true });
    }
  };

  return (
    <>
      <div className={styles.stepHeader}>
        <div className={styles.stepHeaderTop}>
          <span className={styles.stepHeaderOrb} aria-hidden='true'>
            <UsersThreeIcon size={26} weight='duotone' />
          </span>
          <TypographyAtom variant='h3' className={styles.stepTitle}>
            {t('roleTitle')}
          </TypographyAtom>
        </div>
        <p className={styles.stepSubtitle}>{t('roleSubtitle')}</p>
        {prefilled ? (
          <span className={styles.stepHint}>{t('rolePrefilledHint')}</span>
        ) : null}
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
              onSelect={() => field.onChange('stylist')}
            />
            <RoleCard
              roleValue='client'
              icon={<HeartIcon size={28} weight='duotone' />}
              title={t('clientRoleTitle')}
              description={t('clientRoleDesc')}
              selected={field.value === 'client'}
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

      {showConsentForm ? (
        <div className={styles.termsGate}>
          <div className={styles.termsGateHeader}>
            <TypographyAtom
              variant='caption'
              className={styles.termsGateEyebrow}>
              {t('client.termsTitle')}
            </TypographyAtom>
            <TypographyAtom variant='body2' className={styles.termsGateDesc}>
              {t.rich('client.termsDesc', {
                terms: chunks => (
                  <Link
                    prefetch={false}
                    href={ROUTES_FRONT.TERMS}
                    className={styles.termsGateLink}
                    target='_blank'
                    rel='noopener noreferrer'>
                    {chunks}
                  </Link>
                ),
                privacy: chunks => (
                  <Link
                    prefetch={false}
                    href={ROUTES_FRONT.PRIVACY}
                    className={styles.termsGateLink}
                    target='_blank'
                    rel='noopener noreferrer'>
                    {chunks}
                  </Link>
                ),
              })}
            </TypographyAtom>
          </div>
          <Controller
            control={control}
            name='terms_accepted'
            rules={{
              validate: (v: boolean) => v || t('client.termsRequired'),
            }}
            render={({ field, fieldState }) => (
              <>
                <CheckboxAtom
                  className={styles.consentRow}
                  label={t('client.acceptTerms')}
                  checked={field.value}
                  onChange={e => field.onChange(e.target.checked)}
                />
                {fieldState.error?.message ? (
                  <span className={styles.fieldError} role='alert'>
                    {fieldState.error.message}
                  </span>
                ) : null}
              </>
            )}
          />
          {showMarketing ? (
            <Controller
              control={control}
              name='marketing_consent'
              render={({ field }) => (
                <CheckboxAtom
                  className={styles.consentRow}
                  label={t('client.acceptMarketing')}
                  checked={field.value}
                  onChange={e => field.onChange(e.target.checked)}
                />
              )}
            />
          ) : null}
        </div>
      ) : null}

      {/* DECISION (nie usuwaj tego komentarza):
       * "Zaznacz wszystkie" pokazujemy TYLKO gdy widoczna jest >1 zgoda (stylistka:
       * regulamin + marketing). Dla klientki (sam regulamin) byłby redundantny z samym
       * checkboxem regulaminu, więc go ukrywamy. Select-all zaznacza obowiązkowy
       * regulamin RAZEM z opcjonalnym marketingiem jednym klikiem. Marketing
       * pozostaje OSOBNYM,
       * domyślnie ODZNACZONYM, samodzielnie odznaczalnym checkboxem (opt-in zachowany);
       * select-all nie jest pre-checked. */}
      {showMarketing ? (
        <label className={styles.selectAllRow}>
          <input
            type='checkbox'
            className={styles.selectAllNativeInput}
            checked={allConsentsChecked}
            onChange={e => handleSelectAll(e.target.checked)}
          />
          <span className={styles.selectAllBox} aria-hidden='true'>
            {allConsentsChecked ? <CheckIcon size={14} weight='bold' /> : null}
          </span>
          <span className={styles.selectAllText}>{t('client.selectAll')}</span>
        </label>
      ) : null}
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
}

function RoleCard({
  roleValue,
  icon,
  title,
  description,
  selected,
  onSelect,
}: RoleCardProps) {
  return (
    <button
      type='button'
      role='radio'
      aria-checked={selected}
      data-role={roleValue}
      className={`${styles.roleCard} ${
        selected ? styles.roleCardSelected : ''
      } haptic-press`}
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
