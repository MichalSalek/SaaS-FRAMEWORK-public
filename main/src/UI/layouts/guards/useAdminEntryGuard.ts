import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ROUTES_FRONT_APP } from '@kernel/domain/routing/routing.config';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import { getFromClientStorage } from '../../../application/client-device-storage/clientStorage.possibilities.api';

interface UseAdminEntryGuardArgs {
  /** True when the current account is admin. */
  isAdmin: boolean;
  /** True when an admin is impersonating a user ("become user"). */
  isBecomeUser: boolean;
}

/**
 * Admin entry redirect: an admin who lands on `/app` is bounced to the admin
 * panel (`/app/admin`, AdminLayout) on EVERY viewport.
 *
 * DECISION (nie usuwaj tego komentarza) — owner 2026-09-22, replaces S37
 * "wariant A" (desktop >=1280 only):
 * The panel is the admin's only home. AdminLayout is fully mobile-capable
 * (bottom tabs + hamburger sidebar), so the second, mobile-only "Panel
 * administratora" overview that /app used to render inside AppLayout below
 * 1280px was duplicated navigation: its header repeated the H1, its stats
 * repeated /app/admin, its quick actions repeated the bottom tabs. That view is
 * deleted; /app for an admin is now always a redirect. Exempt: become-user
 * impersonation, where the admin views the product AS that user and /app is
 * the user's dashboard.
 *
 * Impersonation is checked twice: `isBecomeUser` (useAppRole, read in an
 * effect) and a SYNCHRONOUS read of the become-user token here, because on a
 * cache-warm first render `isBecomeUser` is still false and an impersonating
 * admin would be bounced out of the user's dashboard (same belt as
 * useOnboardingPlanGuard).
 *
 * Returns true while the redirect is in flight so AppLayout renders an empty
 * shell instead of flashing the dashboard skeleton before replace() lands.
 * SSR-safe: `mounted` is false on the server and on the first client render,
 * so both agree regardless of how early the session resolves; the redirect
 * fires post-mount.
 *
 * Client-side entry guard (mirror of useDesktopRedirectGuard /
 * useNativeEntryRedirectGuard), NOT Next middleware: the whole /app surface is
 * SSG + token-in-localStorage, so edge middleware has no session.
 */
export function useAdminEntryGuard({
  isAdmin,
  isBecomeUser,
}: UseAdminEntryGuardArgs): boolean {
  const router = useRouter();
  const { pathname } = router;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const becomeToken = getFromClientStorage({ key: CUSTOM_HEADERS.becomeUser });
  const isImpersonatingSync = becomeToken !== null && becomeToken !== '';
  const shouldRedirect =
    mounted &&
    isAdmin &&
    !isBecomeUser &&
    !isImpersonatingSync &&
    pathname === ROUTES_FRONT_APP.APP;
  useEffect(() => {
    if (shouldRedirect) {
      void runInstant(
        'admin-entry-guard',
        () => router.replace(ROUTES_FRONT_APP.ADMIN),
        ROUTES_FRONT_APP.ADMIN
      );
    }
  }, [shouldRedirect, router]);
  return shouldRedirect;
}
