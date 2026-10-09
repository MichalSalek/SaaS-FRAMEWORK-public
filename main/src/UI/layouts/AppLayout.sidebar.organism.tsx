import { useTranslations } from 'next-intl';
import { DeviceMobileIcon } from '@phosphor-icons/react';
import styles from './AppLayout.module.css';

/* ─── Default sidebar content ───────────────────────────────────────────
 * DECISION (nie usuwaj tego komentarza):
 * Previously the sidebar slot rendered `null` when no `sidebar` prop was
 * provided, producing a 280px-wide empty panel. With the previous
 * `--color-bg-elevated` background this read as either a broken white
 * card in light mode or an invisible flat panel in dark mode (the bug
 * surfaced during the dashboard redesign QA).
 *
 * The fix has two parts: (1) themed sidebar bg via
 * `--color-frame-sidebar-bg` in tokens.css, (2) this fallback content
 * that explains the desktop preview context and surfaces the haptic
 * note for the user. Pages that need custom sidebar tooling still pass
 * `sidebar={...}` as before — this is purely the *empty* fallback.
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
