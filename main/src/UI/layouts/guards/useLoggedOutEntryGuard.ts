import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { RoleValue } from '@kernel/models/db_models.manual.dto';
import { PERMISSIONS_POLICY } from '@kernel/policies/permissions.policy';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import type { DesktopAccessDecision } from '../../../application/policies/desktop-access.policy';
import { resolveRouteAccessCategory } from '../../../application/policies/route-access.policy';

interface UseLoggedOutEntryGuardArgs {
  /** Token presence (useAuth().isLoggedIn), single read from AppLayout. */
  isLoggedIn: boolean;
  /** Live desktop-access decision (single read from AppLayout). */
  desktopAccess: DesktopAccessDecision;
}

/**
 * Logged-out entry redirect: a visitor WITHOUT a session token who opens an /app route that
 * requires login goes to `/user/login?from=<path>` (locale and query kept). Empty shell meanwhile.
 *
 * DECISION: the client decides without waiting for three 401s.
 *   - Signal = TOKEN PRESENCE; a stale token is left to the server verdict (auth-token-teardown).
 *   - ENTRY only: `loggedInAtMount` latches the first render; a later token loss is navigated by
 *     logout()/the pipeline, and a second replace() here would race them.
 * Routes needing login come from the kernel permission policy. SSR-safe: `mounted` is false on the server and first client render. The `?authCode` exchange
 * never reaches this guard without a token: AuthProvider renders its fallback until it settles.
 */
/**
 * True when the desktop bounce (useDesktopRedirectGuard) will move this visitor ('redirect' AND a
 * product route), so this guard must not fire a second replace(). Account routes are exempt.
 */
export function isLeftToDesktopBounce(
  desktopAccess: DesktopAccessDecision,
  pathname: string
): boolean {
  return (
    desktopAccess === 'redirect' &&
    resolveRouteAccessCategory(pathname) === 'product-route'
  );
}

export function useLoggedOutEntryGuard({
  isLoggedIn,
  desktopAccess,
}: UseLoggedOutEntryGuardArgs): boolean {
  const router = useRouter();
  const { pathname } = router;
  const loggedInAtMount = useRef(isLoggedIn);
  const redirectFired = useRef(false);
  const entryAddress = useRef(
    typeof window === 'undefined'
      ? ''
      : `${window.location.pathname}${window.location.search}`
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const requiresLogin =
    !PERMISSIONS_POLICY.utils.GET_PERMISSION_APPROVAL_FOR_ROUTE({
      role: RoleValue.NOT_LOGGED_IN,
      requestedRoutePath: pathname,
    });
  const shouldRedirect =
    mounted &&
    !isLoggedIn &&
    !loggedInAtMount.current &&
    !isLeftToDesktopBounce(desktopAccess, pathname) &&
    requiresLogin;
  useEffect(() => {
    if (!shouldRedirect || redirectFired.current) {
      return;
    }
    redirectFired.current = true;
    const from = entryAddress.current;
    void runInstant(
      'logged-out-entry-guard',
      () =>
        router.replace({ pathname: ROUTES_FRONT.USER_LOG, query: { from } }),
      ROUTES_FRONT.USER_LOG
    );
  }, [shouldRedirect, router]);
  return shouldRedirect;
}
