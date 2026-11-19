import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import type { DesktopAccessDecision } from '../../../application/policies/desktop-access.policy';
import { resolveRouteAccessCategory } from '../../../application/policies/route-access.policy';
import { authClient } from '../../../application/auth/better-auth-client';
import { useHasLiveAccountSession } from '../../contexts/AuthContext.composition';

interface UseDesktopRedirectGuardArgs {
  desktopAccess: DesktopAccessDecision;
}

/** Pure decision output for the desktop product-route bounce. */
export type DesktopBounceDecision =
  | { kind: 'redirect'; target: string }
  /** Bare /app with a token whose session is still resolving — wait for it to
   *  settle before choosing between the account shell and /get-app. */
  | { kind: 'hold' }
  /** Route is not bounced at all (account/static/get-app). */
  | { kind: 'none' };

interface DesktopBounceInputs {
  /** `router.pathname` — internal Next path (no locale prefix, no query). */
  pathname: string;
  /** `useHasLiveAccountSession()` — token present AND session not settled-invalid. */
  hasLiveSession: boolean;
  /** Better Auth `useSession().isPending` — session still resolving. */
  isSessionPending: boolean;
}

/**
 * Resolve WHERE a desktop `redirect`-context visitor should be bounced for the
 * given product-zone pathname. Pure and exported for unit tests — the hook
 * below owns the side-effect only.
 *
 * DECISION: a logged-in desktop visitor (PREVIEW/PROD) on bare `/app` lands on
 * APP_HOME (start screen with the get-app banner), not on /get-app and not on
 * the account form. This one point covers every path that ends on `/app`
 * (post-login fallback, onboarding exit, deep links). Other product routes and
 * logged-out visitors still go to /get-app; admin, become-user and dev/staging
 * get 'frame' from resolveDesktopAccess and never reach this. The signal is the
 * LIVE session, not token presence, and a pending session returns 'hold'
 * because replace() is irreversible. (owner)
 */
export function resolveDesktopBounceDecision({
  pathname,
  hasLiveSession,
  isSessionPending,
}: DesktopBounceInputs): DesktopBounceDecision {
  if (pathname === ROUTES_FRONT.GET_APP) {
    return { kind: 'none' };
  }
  // Account routes are NOT bounced on desktop — they are the web-login /
  // AccountWebLayout surface. Only the mobile-only product zone redirects.
  if (resolveRouteAccessCategory(pathname) !== 'product-route') {
    return { kind: 'none' };
  }
  if (pathname === ROUTES_FRONT.APP) {
    if (hasLiveSession && isSessionPending) {
      // Token present, session not settled — do not guess; wait for the edge.
      return { kind: 'hold' };
    }
    if (hasLiveSession) {
      return { kind: 'redirect', target: ROUTES_FRONT.APP_HOME };
    }
  }
  return { kind: 'redirect', target: ROUTES_FRONT.GET_APP };
}

/**
 * Desktop-access redirect side-effect: when the policy resolves to `redirect`
 * (non-admin desktop visitor), route the user away from the mobile-only
 * product zone. Target selection lives in `resolveDesktopBounceDecision`
 * (pure, unit-tested); `desktopAccess` comes in as a parameter — the hook does
 * not re-subscribe to `useDesktopAccess` (single source in AppLayout).
 *
 * DECISION: only product routes (the mobile-only app zone) are bounced. Account
 * routes (login, onboarding, account, billing) are web-login-first and must
 * stay reachable on a laptop, and /get-app is excluded so the bounce cannot
 * loop. Classification SSOT: resolveRouteAccessCategory; target selection:
 * resolveDesktopBounceDecision above.
 */
export function useDesktopRedirectGuard({
  desktopAccess,
}: UseDesktopRedirectGuardArgs): void {
  const router = useRouter();
  // Same live-session signal pair as useLoggedInRedirectGuard: optimistic
  // token-presence collapsed to settled truth once `isPending` clears.
  const hasLiveSession = useHasLiveAccountSession();
  const { isPending } = authClient.useSession();

  useEffect(() => {
    if (desktopAccess !== 'redirect') {
      return;
    }
    const decision = resolveDesktopBounceDecision({
      pathname: router.pathname,
      hasLiveSession,
      isSessionPending: isPending,
    });
    if (decision.kind !== 'redirect') {
      return;
    }
    // D6: the bounce target is an UNPREFIXED internal href; the current locale
    // is passed explicitly so a user who landed on /en/app is bounced to
    // /en/app/home (Next would keep it implicitly — explicit is
    // testable and survives a future router that does not).
    void runInstant(
      'desktop-redirect-guard',
      () =>
        router.replace(
          decision.target,
          undefined,
          router.locale ? { locale: router.locale } : undefined
        ),
      decision.target
    );
  }, [desktopAccess, router, hasLiveSession, isPending]);
}
