import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';
// UI/features/account/components/NotificationPrefsSection.tsx
// Push/email-digest notifications toggle. Optimistic update via
// `useChangeNotifications`.
//
// DECISION: this switch (and the onboarding one, OnboardingPage.parts.helpers.ts) stores
// `users.notifications_enabled`, which controls ACTIVITY emails: new message, pairing request,
// client connected by QR, shared inspiration session (web-1
// application/email-handler/activity-email-consent.ts). Transactional and lifecycle mail ignore it.
// (owner)
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { BellIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { ToggleAtom } from '../../../components/Toggle/Toggle.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { useChangeNotifications } from '../hooks/useChangeNotifications';
import { PushOptInOrganism } from '../../shared/push/PushOptIn.organism';
import styles from '../AccountPage.module.css';

/* ─── Props ─── */

interface NotificationPrefsSectionProps {
  notificationsEnabled: boolean;
}

/* ─── Component ─── */

export function NotificationPrefsSectionOrganism({
  notificationsEnabled,
}: NotificationPrefsSectionProps) {
  const t = useTranslations('account.notifications');
  const { mutate, isPending, isError, isSuccess } = useChangeNotifications();

  const tOutcome = useTranslations('components.outcomeFeedback');

  const handleToggle = () => {
    // DECISION: no local onError. The HTTP interceptor (event-bus Stage 1) toasts the error; the
    // useChangeNotifications hook does the optimistic rollback. A local push of
    // CANNOT_UPDATE_NOTIFICATION_PREFERENCES (a frontend event the backend does not emit) duplicated
    // the toast.
    mutate({ notifications_enabled: !notificationsEnabled });
  };

  return (
    <section className={styles.notifSection} data-app-section='bordered'>
      <div className={styles.sectionHeader}>
        <BellIcon size={20} />
        <TypographyAtom
          variant='h4'
          className={styles.notifHeading}
          data-app-section-title=''>
          {t('sectionTitle')}
        </TypographyAtom>
      </div>

      <div className={styles.notifList}>
        <div className={styles.notifRow}>
          <div className={styles.notifLabel}>
            <TypographyAtom variant='body2'>{t('pushLabel')}</TypographyAtom>
            <TypographyAtom
              variant='caption'
              color='var(--color-text-secondary)'>
              {t('pushCaption')}
            </TypographyAtom>
          </div>
          <ToggleAtom
            checked={notificationsEnabled}
            onChange={handleToggle}
            disabled={isPending}
            aria-label={t('pushAriaLabel')}
          />
        </div>
        {/* Notifications v2: the device-level switch (browser or Android
            permission). Hidden where push is impossible. */}
        <div className={styles.notifRow}>
          <PushOptInOrganism />
        </div>
      </div>
      <CompletionLineMolecule
        state={
          isPending
            ? 'pending'
            : isError
              ? 'error'
              : isSuccess
                ? 'complete'
                : 'idle'
        }
        message={
          isPending
            ? tOutcome('savePending')
            : isError
              ? tOutcome('saveFailed')
              : isSuccess
                ? tOutcome('saveDone')
                : ''
        }
        reserveMessage={tOutcome('saveFailed')}
      />
    </section>
  );
}
