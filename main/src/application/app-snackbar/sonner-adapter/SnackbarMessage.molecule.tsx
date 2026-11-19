import type { ReactNode } from 'react';
import styles from './SnackbarMessage.module.css';
/** Adapter-owned toast content keeps the application layer independent of UI. */
export const SnackbarMessageMolecule = ({
  label,
  message,
}: {
  label: ReactNode;
  message: ReactNode;
}) => (
  <span>
    <span className={styles.accessibleLabel}>{label}</span>
    {message}
  </span>
);
