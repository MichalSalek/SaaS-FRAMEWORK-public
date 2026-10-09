/**
 * Route Access Policy (DDD) — companion to `desktop-access.policy.ts`.
 *
 * Single source of truth for classifying a frontend pathname into an
 * ACCESS CATEGORY that governs whether the route is reachable on a desktop
 * viewport for a plain (non-admin / non-dev) visitor.
 *
 * WHY THIS EXISTS (Wave W3 — web-login-first):
 *   The product is mobile-first, so historically EVERY logged-action surface
 *   bounced a desktop PREVIEW/PRODUCTION visitor to /get-app (see
 *   useAppEntryMode / desktop-access.policy). That blanket bounce also caught
 *   the ACCOUNT routes — login, onboarding, billing — which made web sign-up
 *   and web checkout impossible on a laptop. Owner decision: web login is
 *   first-class for EVERYONE (incl. desktop). The product itself (galleries,
 *   feed, dashboard) stays mobile-only.
 *
 *   This policy draws the line: ACCOUNT routes are allowed on desktop;
 *   PRODUCT routes keep the existing mobile-only bounce; STATIC (LP) routes
 *   are not gated at all (always reachable everywhere).
 *
 * DECISION (nie usuwaj tego komentarza):
 *   The categorisation is PREFIX-based, not an exact ROUTES_FRONT lookup, so
 *   it survives query strings, trailing segments and dynamic `[id]` routes
 *   (e.g. `/app/user/account/pay?planId=PRO`). Keep the prefix lists in sync
 *   with ROUTES_FRONT (.shared-kernel/domain/routing/routing.config) — when a
 *   new `/app/user/...` account surface or a new `/app/...` product surface is
 *   added, classify it here. ACCOUNT before PRODUCT in the cascade because
 *   account prefixes (`/app/user/account`) are MORE specific than the product
 *   catch-all (`/app`).
 *
 * Pure module — NO React, NO window, NO ROUTES_FRONT import at runtime (the
 * prefixes are duplicated as literals deliberately so this stays a leaf policy
 * with zero kernel coupling; the DECISION comment above owns the sync contract).
 */

export type RouteAccessCategory = 'account-route' | 'product-route' | 'static';

/**
 * ACCOUNT routes — auth, onboarding and billing surfaces. Allowed on desktop
 * (NOT bounced to /get-app) so web login + web checkout work on a laptop.
 *
 * Mirrors ROUTES_FRONT: USER_LOG, ONBOARDING, APP_HOME, STYLIST_PROFILE_MANAGE,
 * USER_ACCOUNT (+ /pay child), USER_RECOVER, USER_DEL_SELF,
 * USER_ACTIVATE_CLIENT, USER_ACTIVATE_STYLIST, USER_ACTIVITY_LOG,
 * SUPPORT (+ /[threadId] child), SALON_INVITATIONS.
 *
 * DECISION (owner 2026-06-17): activity-log + support są account-management
 * (nie produkt-galeria) → dostępne na desktopie po web-loginie, NIE bounce na
 * /get-app. (ADMIN_SUPPORT zostaje admin-frame, niezależnie od tej kategorii.)
 */
const ACCOUNT_ROUTE_PREFIXES: readonly string[] = Object.freeze([
  '/user/login',
  '/app/onboarding',
  // Web-home strefy /app — ekran startowy desktopu (baner „weź to na telefon"
  // + skróty do konta). Musi być osiągalny na laptopie, bo to CEL bounce'u
  // z gołego /app; gdyby był product-route, guard odbijałby go na /get-app.
  '/app/home',
  // Zarządzanie publicznym profilem (wizytówka + przypięte zdjęcia). Pisanie
  // bio i vanity to praca „przy biurku" — account-management, nie galeria.
  '/app/profile',
  '/app/user/account',
  '/app/user/recover',
  '/app/user/delete-self',
  '/app/user/activate-client',
  '/app/user/activate-stylist',
  '/app/user/activity',
  '/app/user/support',
  // Zaproszenia do zespołu salonu (strona zaproszonej osoby, 2026-09-25). Link
  // z e-maila otwiera się tam, gdzie ona czyta pocztę, także na laptopie, a
  // odpowiedź to decyzja o koncie (zgoda na pokazanie imienia i zdjęcia), nie
  // praca w galerii. Roster właścicielki (`/app/salon/staff`) zostaje produktem.
  '/app/salon/invitations',
  // Checkout return — post-payment status surface, reached on desktop after a
  // web checkout. Account-management (billing), NOT the mobile-only product zone
  // → desktop AccountWebLayout, no /get-app bounce. The page lives at
  // pages/app/checkout/return (no dedicated ROUTES_FRONT const; prefix covers it).
  '/app/checkout',
]);

/**
 * PRODUCT route prefix — the mobile-only app zone (galleries, feed, dashboard,
 * sessions, admin tooling, …). Any `/app/*` path that is NOT an account route
 * falls here. Mirrors ROUTES_FRONT.APP (`/app`).
 */
const PRODUCT_ROUTE_PREFIX = '/app';

/** Strip query string / hash, leaving just the path for prefix matching. */
function normalizePathname(pathname: string): string {
  const queryIndex = pathname.search(/[?#]/);
  return queryIndex === -1 ? pathname : pathname.slice(0, queryIndex);
}

/**
 * Returns true when `pathname` starts with `prefix` at a path BOUNDARY — i.e.
 * the prefix is followed by end-of-string, `/`, `?` or `#`. Prevents a prefix
 * like `/app` from matching an unrelated `/application` static route.
 */
function matchesPrefix(pathname: string, prefix: string): boolean {
  if (!pathname.startsWith(prefix)) {
    return false;
  }
  const nextChar = pathname.charAt(prefix.length);
  return nextChar === '' || nextChar === '/';
}

/**
 * Classify a frontend pathname into its desktop-access category.
 *
 * Cascade (first match wins — account before product because account prefixes
 * are the more specific subset of the `/app` product zone):
 *   1. ACCOUNT_ROUTE_PREFIXES → 'account-route' (allowed on desktop)
 *   2. `/app*`                → 'product-route' (mobile-only, desktop bounce)
 *   3. otherwise              → 'static'        (LP, never gated)
 */
export function resolveRouteAccessCategory(
  pathname: string
): RouteAccessCategory {
  const path = normalizePathname(pathname);

  for (const prefix of ACCOUNT_ROUTE_PREFIXES) {
    if (matchesPrefix(path, prefix)) {
      return 'account-route';
    }
  }

  if (matchesPrefix(path, PRODUCT_ROUTE_PREFIX)) {
    return 'product-route';
  }

  return 'static';
}
