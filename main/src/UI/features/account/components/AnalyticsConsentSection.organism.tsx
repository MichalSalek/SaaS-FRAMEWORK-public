import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { useCookieConsentStore } from '../../../../application/stores/cookieConsent.store';
import { ToggleAtom } from '../../../components/Toggle/Toggle.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import styles from '../AccountPage.module.css';

export function AnalyticsConsentSectionOrganism() {
  const t = useTranslations('cookieBanner.categories.analytics');
  const descriptionId = useId();
  const analytics = useCookieConsentStore(
    state => state.consent?.analytics !== false
  );
  const setAnalytics = useCookieConsentStore(state => state.setAnalytics);

  return (
    <section className={styles.notifSection} data-app-section='bordered'>
      <div className={styles.notifRow}>
        <div className={styles.notifLabel}>
          <TypographyAtom variant='body2'>{t('label')}</TypographyAtom>
          <TypographyAtom
            id={descriptionId}
            variant='caption'
            color='var(--color-text-secondary)'>
            {t('description')}
          </TypographyAtom>
        </div>
        <ToggleAtom
          checked={analytics}
          onChange={event => setAnalytics(event.target.checked)}
          aria-label={t('label')}
          aria-describedby={descriptionId}
        />
      </div>
    </section>
  );
}
