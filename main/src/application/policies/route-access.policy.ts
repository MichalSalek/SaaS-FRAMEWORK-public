/**
 * Route Access Policy (DDD), companion to `desktop-access.policy.ts`: classifies a pathname into an
 * ACCESS CATEGORY that governs desktop reachability for a plain (non-admin / non-dev) visitor.
 * Web login is first-class for everyone (owner), so login, onboarding and billing must not hit the
 * desktop bounce to /get-app. ACCOUNT routes are allowed on desktop; PRODUCT routes keep the
 * mobile-only bounce; STATIC (LP) routes are never gated.
 *
 * DECISION: categorisation is PREFIX-based, not an exact ROUTES_FRONT lookup, so it survives query
 * strings and dynamic `[id]` routes. Keep the prefix lists in sync with ROUTES_FRONT: a new account
 * or product surface must be classified here. ACCOUNT comes before PRODUCT because its prefixes
 * (`/app/user/account`) are MORE specific than the product catch-all (`/app`).
 * Pure module: no React, no window, no runtime ROUTES_FRONT import (prefixes duplicated as literals
 * so this stays a leaf policy).
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
 * DECISION: activity-log and support are account management (not the product gallery), so they
 * are available on desktop after web login and NOT bounced to /get-app (owner).
 * ADMIN_SUPPORT stays admin-frame, independent of this category.
 */
const ACCOUNT_ROUTE_PREFIXES: readonly string[] = Object.freeze([
  '/user/login',
  '/app/onboarding',
  // Web-home of the /app zone: the desktop start screen (a „take it to your phone" banner plus
  // account shortcuts). It must be reachable on a laptop because it is the TARGET of the bounce
  // from bare /app; as a product-route the guard would bounce it to /get-app.
  '/app/home',
  // Public profile management (profile card + pinned photos). Writing bio and vanity URL is desk
  // work: account management, not the gallery.
  '/app/profile',
  '/app/user/account',
  '/app/user/recover',
  '/app/user/delete-self',
  '/app/user/activate-client',
  '/app/user/activate-stylist',
  '/app/user/activity',
  '/app/user/support',
  // Salon team invitations (the invited person's page). The e-mail link opens where she reads mail,
  // also on a laptop, and the answer is an account decision (consent to show name and photo), not
  // gallery work. The owner's roster (`/app/salon/staff`) stays a product route.
  '/app/salon/invitations',
  // Checkout return — post-payment status surface, reached on desktop after a
  // web checkout. Account-management (billing), NOT the mobile-only product zone
  // → desktop AccountWebLayout, no /get-app bounce. The page lives at
  // pages/app/checkout/return (no dedicated ROUTES_FRONT const; prefix covers it).
  '/app/checkout',
  // Notification centre: the target of every push. A push
  // tapped on a laptop must open the list, not bounce to /get-app; the rows
  // that lead into the product zone keep the product rule on their own screens.
  '/app/notifications',
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

  // Notification links can open one session on desktop, without opening the
  // surrounding product lists or unrelated routes to desktop.
  if (/^\/app\/(?:sessions\/[^/]+|inbox\/session\/[^/]+)\/?$/.test(path)) {
    return 'account-route';
  }

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
