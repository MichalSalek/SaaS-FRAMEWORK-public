import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { DISALLOWED_ROUTES_FOR_ANY_ALREADY_LOGGED_ROLE } from '@kernel/domain/permissions/permissions.config';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import { authClient } from '../../../application/auth/better-auth-client';
import { useHasLiveAccountSession } from '../../contexts/AuthContext.composition';
import { resolvePostLoginTarget } from '../../features/auth/LoginPage.helpers';

/**
 * Logged-in entry redirect: a visitor with a LIVE account session must never sit
 * on an auth-entry route (login) — bounce them to /app. Complements the
 * NOT_LOGGED_ONLY route permission (which only gates the reverse direction) and
 * the logout/back-button history hygiene, so the back button can never surface
 * the login form to someone who is already authenticated.
 *
 * DECISION (nie usuwaj tego komentarza):
 * The disallowed-route set is the SSOT `DISALLOWED_ROUTES_FOR_ANY_ALREADY_LOGGED_ROLE`
 * (permissions.config) — "which routes an already-logged user must be redirected
 * away from" — NOT a hardcoded '/user/login'. `router.pathname` is the internal
 * Next path (no locale prefix, no query), so it matches the static route literals
 * in the set directly; the set is widened to ReadonlySet<string> only for the
 * membership check (its element type is the narrower ROUTES_FRONT_STATIC_PATH).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Confirmed-live gate = `useHasLiveAccountSession() && !isPending`. useHasLive…
 * is optimistically TRUE while the Better Auth session is still PENDING (token
 * present) to keep public chrome flicker-free; for a REDIRECT that optimism is
 * wrong — a STALE token would be bounced to /app, 401, and thrown back to login
 * (a visible round-trip). Requiring the session to have SETTLED (`!isPending`)
 * collapses the gate to `isLoggedIn && session !== null` — we only bounce a
 * visitor we KNOW is live. While pending/unknown we do NOT bounce (flicker-free).
 *
 * Client-side entry guard (mirror of useDesktopRedirectGuard / useRecoveryGuard),
 * NOT Next middleware: login is SSG + token-in-localStorage, so edge middleware
 * has no session. The redirect uses `replace` (never push) via the instant
 * system-redirect seam so the login page is dropped from history. A ref latch
 * guards against redundant replaces while the navigation is in flight.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Cel redirectu = `resolvePostLoginTarget(query.from)`, ten SAM resolver co ścieżka
 * po zalogowaniu (LoginPage.helpers): honoruje bezpieczny `?from=` (deep-link, np.
 * gdy LOGIN_FIRST odbił usera z chronionej trasy), a przy jego braku / niebezpiecznej
 * wartości wraca na /app (odrzuca open-redirect i pętlę na /user/login). Dzięki temu,
 * gdy guard i tak-samo-nawigujący flow logowania (dev quick-login robi
 * router.replace(postLoginTarget)) zbiegną się w czasie, OBA celują w to samo miejsce
 * — guard nie nadpisze deep-linku byle-jakim /app.
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
