import { useTranslations } from 'next-intl';
import { BrandLockupMolecule } from '../../components/BrandLockup/BrandLockup.molecule';
import {
  useMaintenanceMessage,
  useMaintenanceMode,
} from './hooks/useMaintenanceMessage';
import styles from './MaintenancePage.module.css';

/**
 * Maintenance page: standalone (no PublicLayout, header or footer). No "go back"
 * CTA: access is temporarily blocked.
 *
 * Traffic arrives from `MaintenanceGateComposition` when the admin switches on
 * `MAINTENANCE_MODE`. A `MAINTENANCE_MESSAGE` replaces the generic text (written
 * ONCE, shown here and on the bar); an empty one falls back to the i18n text.
 *
 * DECISION: no "Zaloguj się" link (owner). A client who used it logged in and the gate
 * sent her straight back here, so the link looked broken. The administrator reaches login
 * by address (the USER_LOG route stays in ALWAYS_OPEN in MaintenanceGate). Polling every
 * minute stays: the rest of the product reads the configuration once per five minutes and
 * someone sent here has no navigation. When the knob disappears, MaintenanceGate sends her home.
 */
export function MaintenancePageComposition() {
  const t = useTranslations('static.maintenance');
  const adminMessage = useMaintenanceMessage().trim();
  // A shorter interval than the rest of the product; see the DECISION above.
  useMaintenanceMode({ pollMs: 60_000 });

  return (
    <div className={styles.page}>
      {/* The same idiom as login and welcome (owner): a white card
          without a frame, lockup, title, ONE sentence about what is happening
          and a quiet line about the return. No action: access is suspended
          (the DECISION above).
          The `error500` drawing (shared with the technical downtime) does not
          exist yet: assets-library/BRAKI-W-APLIKACJI.md, item 9. */}
      <div className={styles.card}>
        <BrandLockupMolecule
          className={styles.brandLockup}
          markClassName={styles.brandMark}
        />
        <h1 className={styles.heading}>{t('heading')}</h1>
        {/* The admin message, when set */}
        <p className={styles.body}>
          {adminMessage.length > 0 ? adminMessage : t('body')}
        </p>
        <p className={styles.eta} role='status' aria-live='polite'>
          {t('eta')}
        </p>
      </div>
    </div>
  );
}
