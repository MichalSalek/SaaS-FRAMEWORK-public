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
 * DECISION (nie usuwaj tego komentarza) — owner 2026-07-10, doprecyzowane
 * 2026-09-09:
 * ZALOGOWANY plain user na desktopie ≥1280 (PREVIEW/PROD), który trafia na GOŁY
 * `/app` (index — strona rozdzielająca role, pełny produkt jest mobile-only),
 * ląduje na ROUTES_FRONT.APP_HOME (AccountWebLayout), NIE na /get-app.
 * Celem bounce'u było KIEDYŚ `USER_ACCOUNT`, czyli formularz ustawień —
 * użytkownik po samouczku lądował od razu w polach do wypełnienia i nie
 * wiedział, co dalej (zgłoszenie ownera 2026-09-09). `APP_HOME` to ekran
 * startowy: ten sam baner co na `/get-app` („produkt bierzesz na telefon")
 * plus skróty. Konto jest o jedno kliknięcie w railu.
 * Jeden punkt pokrywa WSZYSTKIE ścieżki dojścia: post-login fallback
 * (resolvePostLoginTarget → /app), powrót z onboardingu (enterApp → /app),
 * useLoggedInRedirectGuard, social-signin callbackURL, deep-linki i zakładki na
 * /app — bez dotykania samego resolvera (który obsługuje też `?from=`).
 * Granice tej decyzji:
 *   • TYLKO exact `/app` — pozostałe product-routes (galeria, feed, sesje)
 *     bounce'ują na /get-app jak dotąd (produkt zostaje mobile-only).
 *   • TYLKO zalogowani — visitor bez tokenu idzie na /get-app bez zmian.
 *   • Admin / become-user / devMode / DEV / STAGING nie wchodzą tu wcale —
 *     resolveDesktopAccess daje im 'frame', nie 'redirect' (admin na /app ma
 *     własny useAdminEntryGuard → /app/admin).
 * Sygnał zalogowania = useHasLiveAccountSession, NIE samo isLoggedIn
 * (token-presence kłamie przy stale tokenie — patrz DECISION w AuthContext).
 * Przy tokenie z sesją jeszcze PENDING wstrzymujemy bounce ('hold') do
 * rozstrzygnięcia — replace jest nieodwracalny, a lite-dashboard i tak renderuje
 * pusty shell na product-route, więc nic nie mryga; visitor bez tokenu ma
 * hasLiveSession=false od razu i NIE czeka. Lustro reguły „only bounce a
 * visitor we KNOW is live" z useLoggedInRedirectGuard.
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
 * DECISION (nie usuwaj tego komentarza):
 * Route-aware bounce (W3 + W5). ONLY product routes (the mobile-only app zone)
 * are bounced on a desktop PREVIEW/PROD plain visitor. ACCOUNT routes
 * (login / onboarding / account / billing) are web-login-first and MUST stay
 * reachable on a laptop — they render the AccountWebLayout (or the onboarding
 * full-screen flow) instead. The /get-app route itself is also excluded so it
 * stays reachable. Classification SSOT: resolveRouteAccessCategory (W3 policy).
 * Bounce TARGET is route + session aware since 2026-07-10 (owner decision, see
 * resolveDesktopBounceDecision above): logged-in on bare /app → APP_HOME,
 * everything else → /get-app.
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
