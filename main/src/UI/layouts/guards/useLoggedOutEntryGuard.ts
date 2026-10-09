import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { RoleValue } from '@kernel/models/db_models.manual.dto';
import { PERMISSIONS_POLICY } from '@kernel/policies/permissions.policy';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import type { DesktopAccessDecision } from '../../../application/policies/desktop-access.policy';

interface UseLoggedOutEntryGuardArgs {
  /** Token presence (useAuth().isLoggedIn), single read from AppLayout. */
  isLoggedIn: boolean;
  /** Live desktop-access decision (single read from AppLayout). */
  desktopAccess: DesktopAccessDecision;
}

/**
 * Logged-out entry redirect: a visitor WITHOUT a session token who opens an
 * /app route that requires login goes straight to `/user/login?from=<path>`.
 * The shell renders empty meanwhile, so no page mounts and no authed query
 * leaves the browser.
 *
 * DECISION (nie usuwaj tego komentarza) — S122 QA:
 * Before this guard the ONLY thing that moved an anonymous visitor off /app was
 * the backend: the dashboard rendered its client variant (the role defaults to
 * client), fired conversations + get-my-pairs + favorites, got three 401
 * LOGIN_FIRST, and the event pipeline redirected. Every anonymous visit logged
 * three failed requests to reach a decision the client already knew. Now:
 *   • Signal = TOKEN PRESENCE, same doctrine as useNativeEntryRedirectGuard: no
 *     token is an unambiguous "logged out". A STALE token (present, session
 *     dead) is NOT handled here; it still goes the server-verdict way (401 →
 *     auth-token-teardown drops it → pipeline redirects with `?from=`), the
 *     one path that can prove a token dead. Using the settled Better Auth
 *     session instead would bounce a fresh quick-login whose session refetch
 *     failed (DECISION in useLoginFlows).
 *   • ENTRY only: `loggedInAtMount` latches the token state of the first render.
 *     A shell that mounted logged in and then lost the token (logout, token
 *     teardown) is navigated by logout()/the pipeline; firing a second
 *     replace() here would race them.
 *   • Which routes need login = PERMISSIONS_FOR_ROLE_BY_ROUTE (kernel SSOT, the
 *     same check the pipeline runs), not a path list.
 *   • Desktop PREVIEW/PROD plain visitors (`desktopAccess === 'redirect'`) are
 *     routed by useDesktopRedirectGuard (product routes → /get-app); this guard
 *     stays out so the two never compete for one replace().
 *   • `from` = the path the visitor asked for, locale prefix and query kept, so
 *     a deep link (e.g. ?tab=stylists) survives the login round trip;
 *     LoginPage's resolvePostLoginTarget validates it.
 *
 * SSR-safe: `mounted` is false on the server and on the first client render
 * (token presence differs between the two), so both render the same tree; the
 * redirect fires post-mount. The variant-C `?authCode` exchange never reaches
 * this guard with a missing token: AuthProvider renders its fallback INSTEAD of
 * the app until the exchange settles.
 */
export function useLoggedOutEntryGuard({
  isLoggedIn,
  desktopAccess,
}: UseLoggedOutEntryGuardArgs): boolean {
  const router = useRouter();
  const { pathname } = router;
  const loggedInAtMount = useRef(isLoggedIn);
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
    desktopAccess !== 'redirect' &&
    requiresLogin;
  useEffect(() => {
    if (!shouldRedirect) {
      return;
    }
    const from = `${window.location.pathname}${window.location.search}`;
    void runInstant(
      'logged-out-entry-guard',
      () =>
        router.replace({ pathname: ROUTES_FRONT.USER_LOG, query: { from } }),
      ROUTES_FRONT.USER_LOG
    );
  }, [shouldRedirect, router]);
  return shouldRedirect;
}
