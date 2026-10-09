// layouts/ImpersonationBanner.tsx
// Globally-mounted sticky banner shown while an admin is impersonating another
// user. Mounted in `_app.tsx` (above all layouts) so it appears regardless of
// which layout (PublicLayout / AppLayout / AdminLayout) the current page uses.
//
// Visibility: gated by `useAppRole().isBecomeUser` — which reads the
// CUSTOM_HEADERS.becomeUser token presence in browser storage. SSR-safe
// (returns false on the server and during hydration until the effect runs).
//
// Actions:
//   • "Switch back" → useSwitchBackBecomeUser → full reload into the admin
//     screen the impersonation started from (filters kept in the URL)
//   • "Refresh" → useRefreshImpersonation → extends the 2h impersonation TTL
//
// DECISION (nie usuwaj tego komentarza):
// We never read or render the opaque become-user token. The banner identifies
// the impersonated user via `useCurrentUserAccount()` (TQ-cached CurrentUser),
// not via the token. Storage token = opaque <ref_id>.<expires_ms>.<hmac>, no
// PII inside, no point exposing.
//
// Banner is sticky-top with z-index above the AppLayout AppBar (100). It
// stacks ABOVE the chrome — admin always sees the switch-back affordance no
// matter how deep in the impersonated user's flow they navigate.

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
          className={`${styles.button} haptic-press`}
          onClick={handleRefresh}
          disabled={refreshPending || switchBackPending}
          aria-label={t('refreshAriaLabel')}>
          <ArrowsClockwiseIcon size={14} weight='regular' aria-hidden='true' />
          {refreshPending ? t('refreshPending') : t('refresh')}
        </button>
        <button
          type='button'
          className={`${styles.button} ${styles.buttonPrimary} haptic-press`}
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
