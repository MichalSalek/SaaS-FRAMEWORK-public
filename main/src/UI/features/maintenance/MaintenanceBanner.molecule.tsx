// main/src/UI/features/maintenance/MaintenanceBanner.tsx
// Global maintenance banner — shows the admin-set MAINTENANCE_MESSAGE runtime config.
// NON-dismissable (operational notice, not editorial), single full-width strip.
// Empty / whitespace-only message → renders nothing. SSR-safe (sourced from TQ hook,
// which yields '' until hydrated). Anti-AI-slop: flat solid fill, zero gradient/shadow/glow.

import { WrenchIcon } from '@phosphor-icons/react';
import { useMaintenanceMessage } from './hooks/useMaintenanceMessage';
import styles from './MaintenanceBanner.module.css';

export function MaintenanceBannerMolecule() {
  const message = useMaintenanceMessage();

  // Gate: empty or whitespace-only message = no active maintenance → render nothing.
  if (message.trim().length === 0) {
    return null;
  }

  // DECISION (nie usuwaj tego komentarza): pasek NIE ma `aria-label`. Stała
  // angielska nazwa („Maintenance notice") w produkcie mówiącym trzema językami
  // byłaby pierwszym problemem, ale gorszy jest drugi: to jest obszar live,
  // którego sensem JEST jego treść — komunikat ustawiony przez administratora.
  // Nazwa dostępna na live-regionie potrafi przykryć dokładnie to, co ma zostać
  // ogłoszone. `aria-atomic` każe czytnikowi przeczytać całą treść naraz i to
  // wystarcza.

  return (
    <div
      className={styles.banner}
      role='status'
      aria-live='polite'
      aria-atomic='true'>
      <span className={styles.icon} aria-hidden='true'>
        <WrenchIcon size={16} weight='fill' />
      </span>
      <span className={styles.message}>{message}</span>
    </div>
  );
}
