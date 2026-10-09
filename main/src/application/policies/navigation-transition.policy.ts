/**
 * Navigation Transition Policy (NVT) — companion to `route-access.policy.ts`.
 *
 * Single source of truth for the DEFAULT transition policy of a target
 * pathname (UX Policy matrix, PLAN_NAVIGATION_TRANSITIONS §UX Policy):
 *
 *   - `/app/**` product + admin shell → 'slide'  (native push/pop feel)
 *   - standalone auth/entry surfaces  → 'instant' (login/welcome — inbound
 *     system surfaces, not product navigation)
 *   - everything else (LP/blog/legal) → 'fade'
 *
 * One-shot intents (`runNavigationIntent` / `runInstant`) OVERRIDE this
 * default — guards, pipeline redirects and identity switches always pass
 * an explicit 'instant' policy through the seam.
 *
 * Pure module — NO React, NO window. Locale prefixes are stripped before
 * matching because Next route-event urls are locale-prefixed for non-default
 * locales (`/en/about`) while ROUTES_FRONT constants are not.
 */

import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

export type NavTransitionPolicy = 'slide' | 'fade' | 'instant';

/** Standalone entry surfaces — instant inbound by default (UX Policy matrix). */
const STANDALONE_INSTANT_PREFIXES: readonly string[] = Object.freeze([
  ROUTES_FRONT.USER_LOG,
  ROUTES_FRONT.WELCOME,
]);

const PRODUCT_SHELL_PREFIX = ROUTES_FRONT.APP;

/** Strip query string / hash, leaving just the path. */
function pathnameOf(url: string): string {
  const queryIndex = url.search(/[?#]/);
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

/**
 * Strip a leading non-default locale segment (`/en/foo` → `/foo`) so both
 * ROUTES_FRONT-style targets and locale-prefixed router-event urls compare
 * equal. The default locale (`pl`) is never prefixed by Next.
 */
function stripLocalePrefix(pathname: string): string {
  for (const locale of I18N_CONFIG.locales) {
    const prefix = `/${locale}`;
    if (pathname === prefix) {
      return '/';
    }
    if (pathname.startsWith(`${prefix}/`)) {
      return pathname.slice(prefix.length);
    }
  }
  return pathname;
}

/** Prefix match at a path boundary (`/app` matches `/app/x`, not `/application`). */
function matchesPrefix(pathname: string, prefix: string): boolean {
  if (!pathname.startsWith(prefix)) {
    return false;
  }
  const nextChar = pathname.charAt(prefix.length);
  return nextChar === '' || nextChar === '/';
}

/**
 * THE canonical nav-path form — every NVT comparison (intent target matching,
 * same-path skip, adoption, Explore detection, policy resolution) goes through
 * this one function. Next with `trailingSlash: true` emits MIXED forms
 * (`/en/` on root, prod may slash full paths) while ROUTES_FRONT constants are
 * slash-less — comparing raw strings silently breaks target-bound matching.
 * Strips: query/hash → locale prefix → trailing slash (except root).
 */
export function normalizeNavPathname(url: string): string {
  const path = stripLocalePrefix(pathnameOf(url));
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

/** Default transition policy for a target url/pathname (intent overrides win). */
export function resolveDefaultNavPolicy(url: string): NavTransitionPolicy {
  const path = normalizeNavPathname(url);

  for (const prefix of STANDALONE_INSTANT_PREFIXES) {
    if (matchesPrefix(path, prefix)) {
      return 'instant';
    }
  }

  if (matchesPrefix(path, PRODUCT_SHELL_PREFIX)) {
    return 'slide';
  }

  return 'fade';
}
