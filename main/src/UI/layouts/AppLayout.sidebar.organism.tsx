import { useTranslations } from 'next-intl';
import { DeviceMobileIcon } from '@phosphor-icons/react';
import styles from './AppLayout.module.css';

/* ─── Default sidebar content ───────────────────────────────────────────
 * Fallback for the frame-mode sidebar slot when no `sidebar` prop is passed: an empty
 * 280px panel read as a broken card. Pages with real tooling still pass `sidebar`.
 *
 * Kept in its own module (not exported from AppLayout) so the shell stays a
 * thin composition — this is an internal presentational piece, not public API. */
export function DefaultSidebarContentOrganism() {
  const tApp = useTranslations('layout.app');
  return (
    <>
      <div className={styles.sidebarHeader}>
        <span className={styles.sidebarBadge} aria-hidden='true'>
          <DeviceMobileIcon size={16} weight='fill' />
        </span>
        <h3 className={styles.sidebarTitle}>{tApp('sidebarPreviewTitle')}</h3>
      </div>
      <div className={styles.sidebarBody}>
        <p className={styles.sidebarInfo}>{tApp('sidebarPreviewLead')}</p>
        <div className={styles.sidebarTip}>{tApp('sidebarPreviewTip')}</div>
      </div>
    </>
  );
}
