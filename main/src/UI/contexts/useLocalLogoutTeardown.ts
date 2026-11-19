import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { readLocalePrefix } from '@kernel/domain/routing/app-path.utils';
import {
  clearAuthChannelTokens,
  announceIdentityWillChange,
} from '../../application/auth/auth-token-teardown';
import { deleteFromClientStorage } from '../../application/client-device-storage/clientStorage.possibilities.api';
import { STORAGE_KEYS } from '../../application/client-device-storage/storage-keys.config';
import { requestCancellationService } from '../../application/http/request-cancellation.service';
import { bypassLeaveGuard } from '../../application/routing/leave-guard';
import { clearPurchaseIdentity } from './clearPurchaseIdentity';
import { readDocumentCredentials } from '../../application/auth/document-credentials';

async function clearTokens(expected: string | null): Promise<boolean> {
  // Auth-channel keys (session + impersonation) live in ONE place —
  // auth-token-teardown.clearAuthChannelTokens — shared with the transport-level
  // teardown that drops a server-refused token. Logout composes it with the
  // funnel cleanup below instead of re-listing the keys, so they cannot drift apart.
  if (!(await clearAuthChannelTokens(expected))) {
    return false;
  }
  // Drop the pricing-funnel intent on logout. sessionOnly only scopes per-tab,
  // so a logout->login in the SAME tab (shared device/kiosk) would otherwise let the
  // next user inherit the previous user's plan choice (wrong/pricier plan pre-selected
  // in onboarding + plan-aware login banner). Clear it with the identity.
  deleteFromClientStorage({ key: STORAGE_KEYS.PRICING_FUNNEL });
  // Same reason for the onboarding draft, which carried name, city and phone.
  // Role-only onboarding no longer writes it; this clears older drafts that may
  // still sit in an open tab.
  deleteFromClientStorage({ key: STORAGE_KEYS.ONBOARDING_DRAFT });
  return true;
}

export function useLocalLogoutTeardown(
  queryClient: QueryClient,
  setIsLoggedIn: Dispatch<SetStateAction<boolean>>
) {
  // Local-only logout teardown: abort in-flight requests, clear the query cache,
  // drop client tokens, flip logged-out state, and hard-nav to login. Does NOT
  // hit the backend — the caller decides whether server-side revocation is needed
  // first (logout() awaits signOut() before calling this; the cross-tab storage
  // handler calls it directly because another tab already revoked).
  // Identity teardown WITHOUT navigation: abort in-flight work, drop the cached
  // identity, flip logged-out. Shared by the full local logout below and by the
  // out-of-band token-cleared listener (which must NOT navigate — the event
  // pipeline owns that redirect and its `?from=` deep-link).
  const clearIdentityState = useCallback(
    (clearPersistent = true) => {
      announceIdentityWillChange();
      if (clearPersistent) {
        clearPurchaseIdentity();
      }
      // Abort in-flight requests so they don't resolve against the cleared token
      // (the AppDrawer call-site does not cancelQueries itself).
      requestCancellationService.cancelAll();
      // Centralized cache teardown — every call-site (AppDrawer included) gets
      // cancel + clear for free, no need to wrap logout() at the call-site.
      void queryClient.cancelQueries();
      queryClient.clear();
      setIsLoggedIn(false);
    },
    [queryClient, setIsLoggedIn]
  );

  const localLogoutTeardown = useCallback(
    async (expected: string | null) => {
      clearIdentityState(false);
      const cleared = await clearTokens(expected);
      if (!cleared) {
        bypassLeaveGuard();
        window.location.reload();
        return;
      }
      if (readDocumentCredentials().authorization === null) {
        clearPurchaseIdentity();
      }
      // Navigate to login (works in both SPA and SSR contexts). Use replace(),
      // NOT href: the authed /app shell we are leaving must be dropped from
      // history so a post-logout back-tap can't return to the now-stale
      // authenticated view. Teardown already cleared tokens/cache, so there is
      // nothing on this page worth keeping in the back stack.
      if (typeof window !== 'undefined') {
        // Stay in the language the user was using — `/en/app/...` logs out to
        // `/en/user/login`, the default locale stays unprefixed.
        const locale = readLocalePrefix(window.location.pathname);
        // Tokens are already gone: a leave guard's beforeunload prompt here
        // (upload, admin editors) would let „Zostań" keep the page alive over a
        // dead session (leave-guard.ts bypassLeaveGuard).
        bypassLeaveGuard();
        window.location.replace(
          `${locale ? `/${locale}` : ''}${ROUTES_FRONT.USER_LOG}`
        );
      }
    },
    [clearIdentityState]
  );

  return { clearIdentityState, localLogoutTeardown };
}
