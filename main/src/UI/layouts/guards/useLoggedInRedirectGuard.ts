import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { DISALLOWED_ROUTES_FOR_ANY_ALREADY_LOGGED_ROLE } from '@kernel/domain/permissions/permissions.config';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import { authClient } from '../../../application/auth/better-auth-client';
import { useHasLiveAccountSession } from '../../contexts/AuthContext.composition';
import { resolvePostLoginTarget } from '../../features/auth/LoginPage.helpers';

/**
 * Logged-in entry redirect: a visitor with a LIVE account session must never sit on an
 * auth-entry route (login); bounce to /app. Route set: `DISALLOWED_ROUTES_FOR_ANY_ALREADY_LOGGED_ROLE`.
 *
 * DECISION: the gate is `useHasLiveAccountSession() && !isPending`. The hook is optimistically
 * true while the session is pending (flicker-free chrome), but for a redirect that is wrong: a
 * stale token would go to /app, get a 401 and bounce back to login.
 *
 * DECISION: the target is `resolvePostLoginTarget(query.from)`, the same resolver as the
 * post-login path, so this guard never overwrites a deep link with a bare /app when it races
 * a navigating login flow.
 *
 * Client-side guard, NOT Next middleware (login is SSG + token-in-localStorage). Uses `replace`
 * via the instant seam so login leaves history; a ref latch stops redundant replaces.
 */
export function useLoggedInRedirectGuard(): void {
  const router = useRouter();
  const hasLiveSession = useHasLiveAccountSession();
  const { isPending } = authClient.useSession();
  const { pathname } = router;
  const redirectFired = useRef(false);

  const routeDisallowed = (
    DISALLOWED_ROUTES_FOR_ANY_ALREADY_LOGGED_ROLE as ReadonlySet<string>
  ).has(pathname);
  // Only bounce a visitor we KNOW is live (session settled non-null) — never
  // while the session is still pending/unknown.
  const shouldRedirect = hasLiveSession && !isPending && routeDisallowed;

  useEffect(() => {
    if (!shouldRedirect || redirectFired.current) {
      return;
    }
    redirectFired.current = true;
    const target = resolvePostLoginTarget(router.query.from);
    void runInstant(
      'logged-in-redirect-guard',
      () => router.replace(target),
      target
    );
  }, [shouldRedirect, router]);
}
