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

  // DECISION: the strip has NO `aria-label`. A fixed English name ("Maintenance notice") in a
  // three-language product would be the first problem, but worse: this is a live region whose
  // meaning IS its content (the admin's message), and an accessible name on a live region can cover
  // exactly what should be announced. `aria-atomic` makes the reader read the whole text at once,
  // which is enough.

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
