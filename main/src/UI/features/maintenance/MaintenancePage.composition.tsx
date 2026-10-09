import { useTranslations } from 'next-intl';
import { BrandLockupMolecule } from '../../components/BrandLockup/BrandLockup.molecule';
import {
  useMaintenanceMessage,
  useMaintenanceMode,
} from './hooks/useMaintenanceMessage';
import styles from './MaintenancePage.module.css';

/**
 * Maintenance page — standalone (no PublicLayout, no header/footer).
 *
 * Rendered directly by the thin shell without any layout wrapper.
 * Blocks access to the app during scheduled downtime.
 * No "go back" CTA — the page communicates that access is temporarily blocked.
 *
 * Ruch trafia tu z `MaintenanceGateComposition`, gdy administrator włączy
 * `MAINTENANCE_MODE`. Jeśli przy okazji ustawił `MAINTENANCE_MESSAGE`, to jego
 * treść zastępuje ogólne wyjaśnienie: admin pisze komunikat RAZ i widać go
 * zarówno na pasku nad działającą aplikacją, jak i tutaj. Pusty komunikat
 * (albo awaria odczytu konfiguracji) wraca do tekstu z i18n.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Brak linku „Zaloguj się" (owner 2026-09-22). Klient, który z niego
 * korzystał, logował się, a gate i tak odsyłał go z powrotem na tę stronę,
 * więc link wyglądał jak zepsuty. Administrator wchodzi na logowanie
 * adresem: trasa USER_LOG zostaje na liście ALWAYS_OPEN w MaintenanceGate,
 * bez afordancji na tej stronie. Odpytywanie co minutę zostaje. Reszta
 * produktu czyta konfigurację raz na pięć minut, a ktoś odesłany tutaj nie
 * ma nawigacji. Gdy knob znika, MaintenanceGate odsyła go na stronę główną.
 */
export function MaintenancePageComposition() {
  const t = useTranslations('static.maintenance');
  const adminMessage = useMaintenanceMessage().trim();
  // Krótszy interwał niż reszta produktu — uzasadnienie w DECISION powyżej.
  useMaintenanceMode({ pollMs: 60_000 });

  return (
    <div className={styles.page}>
      {/* Ten sam idiom co logowanie i powitanie (owner 2026-10-08): biała karta
          bez ramy, lockup, tytuł, JEDNO zdanie o tym, co się dzieje, i cicha
          linia o powrocie. Bez akcji: dostęp jest wstrzymany (DECISION wyżej).
          Rysunku `error500` (wspólny z przerwą techniczną) jeszcze nie ma:
          assets-library/BRAKI-W-APLIKACJI.md, pozycja 9. */}
      <div className={styles.card}>
        <BrandLockupMolecule
          className={styles.brandLockup}
          markClassName={styles.brandMark}
        />
        <h1 className={styles.heading}>{t('heading')}</h1>
        {/* Komunikat administratora, gdy jest ustawiony */}
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
