// UI/features/account/components/EmailPrefsSection.tsx
// [EML] Email preferences section -- STYLIST only.
// 3 categories:
//   - Trial sequence emails (toggleable, default ON)
//   - Marketing emails (toggleable, default OFF — DEFAULT_EMAIL_PREFERENCES)
//   - Transactional emails (always ON, disabled — PKE compliance)
// Optimistic update on each toggle via `useUpdateEmailPreferences`.
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { EnvelopeSimpleIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { DEFAULT_EMAIL_PREFERENCES } from '@kernel/models/email/email.dto';
import type { EmailPreferences } from '@kernel/models/email/email.dto';
import { ToggleAtom } from '../../../components/Toggle/Toggle.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { useUpdateEmailPreferences } from '../../shared/email/hooks/useUpdateEmailPreferences';
import styles from '../AccountPage.module.css';

/* ─── Props ─── */

interface EmailPrefsSectionProps {
  preferences: EmailPreferences | null;
}

/* ─── Component ─── */

export function EmailPrefsSectionOrganism({
  preferences,
}: EmailPrefsSectionProps) {
  const t = useTranslations('account.emailPrefs');
  // null defaults to DEFAULT_EMAIL_PREFERENCES (SSOT). Trial=true, marketing=false.
  const current: EmailPreferences = preferences ?? DEFAULT_EMAIL_PREFERENCES;

  const { mutate, isPending } = useUpdateEmailPreferences();

  const handleToggle = (key: keyof EmailPreferences) => {
    const next: EmailPreferences = {
      trial_sequence: current.trial_sequence,
      marketing: current.marketing,
      [key]: !current[key],
    };

    // DECISION: no local onError toast — the HTTP interceptor (event-bus Stage 1)
    // owns the error toast for this pure-transport mutation (backend GENERAL_ERROR
    // on 5xx, INTERNET_CONNECTION_PROBLEM on network). A local GENERAL_ERROR push
    // double-toasted (never dedups against the interceptor's different event key).
    // Optimistic rollback lives in useUpdateEmailPreferences.onError.
    mutate(next);
  };

  return (
    <section className={styles.notifSection}>
      <div className={styles.sectionHeader}>
        <EnvelopeSimpleIcon size={20} />
        <TypographyAtom variant='h4' className={styles.notifHeading}>
          {t('sectionTitle')}
        </TypographyAtom>
      </div>

      <div className={styles.notifList}>
        {/* Trial sequence */}
        <div className={styles.notifRow}>
          <div className={styles.notifLabel}>
            <TypographyAtom variant='body2'>{t('trialLabel')}</TypographyAtom>
            <TypographyAtom
              variant='caption'
              color='var(--color-text-secondary)'>
              {t('trialCaption')}
            </TypographyAtom>
          </div>
          <ToggleAtom
            checked={current.trial_sequence}
            onChange={() => handleToggle('trial_sequence')}
            disabled={isPending}
            aria-label={t('trialAriaLabel')}
          />
        </div>

        {/* Marketing */}
        <div className={styles.notifRow}>
          <div className={styles.notifLabel}>
            <TypographyAtom variant='body2'>
              {t('marketingLabel')}
            </TypographyAtom>
            <TypographyAtom
              variant='caption'
              color='var(--color-text-secondary)'>
              {t('marketingCaption')}
            </TypographyAtom>
          </div>
          <ToggleAtom
            checked={current.marketing}
            onChange={() => handleToggle('marketing')}
            disabled={isPending}
            aria-label={t('marketingAriaLabel')}
          />
        </div>

        {/* Transactional — always ON, disabled */}
        <div className={styles.notifRow}>
          <div className={styles.notifLabel}>
            <TypographyAtom variant='body2'>
              {t('transactionalLabel')}
            </TypographyAtom>
            <TypographyAtom
              variant='caption'
              color='var(--color-text-secondary)'>
              {t('transactionalCaption')}
            </TypographyAtom>
          </div>
          <ToggleAtom
            checked
            disabled
            aria-label={t('transactionalAriaLabel')}
          />
        </div>
      </div>
    </section>
  );
}
