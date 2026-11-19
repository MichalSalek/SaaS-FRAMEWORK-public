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
 * Admin entry redirect: an admin who lands on `/app` is bounced to `/app/admin`
 * (AdminLayout) on EVERY viewport.
 *
 * DECISION: the admin panel is the admin's only home and AdminLayout is mobile-capable, so
 * AppLayout has no mobile admin overview. Exempt: become-user impersonation (/app is the
 * user's dashboard). It is checked twice, `isBecomeUser` plus a SYNCHRONOUS read of the
 * become-user token, because on a cache-warm first render `isBecomeUser` is still false.
 * (owner)
 *
 * Returns true while the redirect is in flight, so AppLayout renders an empty shell instead of
 * the dashboard skeleton. SSR-safe: `mounted` is false on the server and the first client
 * render; the redirect fires post-mount. Client-side guard, NOT Next middleware: /app is SSG +
 * token-in-localStorage, so edge middleware has no session.
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
