// Sticky banner while an admin impersonates someone. Mounted in `_app.tsx` above
// every layout. Visible when `useAppRole().isBecomeUser` sees the become-user
// token (false on the server until hydration).
// DECISION: the banner never reads the opaque token; it names the person from
// `useCurrentUserAccount()`. Switch back reloads the admin screen the session
// started from; refresh extends the 2h TTL. It stacks above the app bar.

import { useTranslations } from 'next-intl';
import {
  UserSwitchIcon,
  EyeIcon,
  ArrowsClockwiseIcon,
} from '@phosphor-icons/react';
import { useAppRole } from './useAppRole';
import { useCurrentUserAccount } from '../shared/hooks/useCurrentUserAccount';
import { resolveUserDisplayName } from '../shared/format/userDisplayName.formatters';
import { useSwitchBackBecomeUser } from '../features/admin/hooks/useSwitchBackBecomeUser';
import { useRefreshImpersonation } from '../features/admin/hooks/useRefreshImpersonation';
import styles from './ImpersonationBanner.module.css';

export function ImpersonationBannerOrganism() {
  const { isBecomeUser } = useAppRole();
  const { data: currentUser } = useCurrentUserAccount();
  const switchBackMut = useSwitchBackBecomeUser();
  const refreshMut = useRefreshImpersonation();
  const t = useTranslations('layout.impersonation');

  // Render nothing unless we're actively impersonating. `isBecomeUser` is
  // false during SSR/initial hydration → no banner flash on first paint
  // for the admin's own session.
  if (!isBecomeUser) {
    return null;
  }

  // While the impersonation effect hasn't resolved yet, fall back to "user".
  // We never log/render the token itself.
  const identity = resolveUserDisplayName(currentUser) ?? t('genericIdentity');

  const handleSwitchBack = () => {
    switchBackMut.mutate();
  };

  const handleRefresh = () => {
    refreshMut.mutate();
  };

  const switchBackPending = switchBackMut.isPending;
  const refreshPending = refreshMut.isPending;

  return (
    <div
      role='status'
      aria-live='polite'
      aria-label={t('ariaLabel')}
      className={styles.banner}
      data-testid='impersonation-banner'>
      <span className={styles.label}>
        <EyeIcon size={16} weight='fill' aria-hidden='true' />
        <span className={styles.labelText}>
          {t('loggedAs')} <span className={styles.identity}>{identity}</span>
        </span>
      </span>
      <span className={styles.actions}>
        <button
          type='button'
          className={`${styles.button} press-feedback`}
          onClick={handleRefresh}
          disabled={refreshPending || switchBackPending}
          aria-label={t('refreshAriaLabel')}>
          <ArrowsClockwiseIcon size={14} weight='regular' aria-hidden='true' />
          {refreshPending ? t('refreshPending') : t('refresh')}
        </button>
        <button
          type='button'
          className={`${styles.button} ${styles.buttonPrimary} press-feedback`}
          onClick={handleSwitchBack}
          disabled={switchBackPending || refreshPending}
          aria-label={t('switchBackAriaLabel')}>
          <UserSwitchIcon size={14} weight='regular' aria-hidden='true' />
          {switchBackPending ? t('switchBackPending') : t('switchBack')}
        </button>
      </span>
    </div>
  );
}
