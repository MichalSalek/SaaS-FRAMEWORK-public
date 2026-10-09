// UI/features/account/components/NotificationPrefsSection.tsx
// Push/email-digest notifications toggle. Optimistic update via
// `useChangeNotifications`.
//
// DECISION (nie usuwaj tego komentarza), owner 2026-09-24/25: this switch (and
// the onboarding one, OnboardingPage.parts.helpers.ts) stores
// `users.notifications_enabled`, which controls ACTIVITY emails: new message,
// pairing request, client connected by QR, shared inspiration session
// (web-1 application/email-handler/activity-email-consent.ts). Transactional
// and lifecycle mail ignore it.
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { BellIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { ToggleAtom } from '../../../components/Toggle/Toggle.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { useChangeNotifications } from '../hooks/useChangeNotifications';
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
  const { mutate, isPending } = useChangeNotifications();

  const handleToggle = () => {
    // DECISION (nie usuwaj tego komentarza):
    // Brak lokalnego onError celowo. Błąd toastuje HTTP interceptor
    // (event-bus, Stage 1) — konkretnym eventem backendu lub
    // INTERNET_CONNECTION_PROBLEM przy sieci/timeout. Optimistic rollback
    // robi hook useChangeNotifications (własny onError na snapshot).
    // Lokalny push CANNOT_UPDATE_NOTIFICATION_PREFERENCES (event frontendowy,
    // backend go nie emituje) dublował toast — usunięty.
    mutate({ notifications_enabled: !notificationsEnabled });
  };

  return (
    <section className={styles.notifSection}>
      <div className={styles.sectionHeader}>
        <BellIcon size={20} />
        <TypographyAtom variant='h4' className={styles.notifHeading}>
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
      </div>
    </section>
  );
}
