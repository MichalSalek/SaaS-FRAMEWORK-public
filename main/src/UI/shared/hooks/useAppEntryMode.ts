// UI/shared/hooks/useAppEntryMode.ts
// Desktop app-entry mode for static-page chrome. Mirrors the Orange-Flex
// doctrine: the product is mobile-first, so on a desktop viewport in
// PREVIEW/PRODUCTION a plain visitor cannot USE the app here — the navbar shows
// a "Otwórz na telefonie" affordance (HeaderUserMenu) and the ForClients page
// hides its "log in via browser" secondary link / points the cold-client CTA at
// /get-app (useClientStartCta, client product is inherently mobile: QR in salon).
//
// NOT for conversion CTAs: signup/trial CTAs (HomePage / ForStylists / Compare /
// ForStudios / Contact / About) and pricing plan CTAs are ACCOUNT-route actions
// that enter the web-login funnel on EVERY viewport (web-login-first, Wave W3) —
// they build the register/pay href directly (see pricingFunnelHref DECISION),
// never gated by this hook. `useLoginCtaHref` (the old get-app bounce for login
// CTAs) was REMOVED 2026-07-18 when the last of those CTAs migrated to the
// funnel — routing signup to /get-app dead-ended the desktop web funnel.
//
// Reuses the exact `resolveDesktopAccess()` cascade that gates the /app zone
// (viewport < 1280 / DEVELOPMENT|STAGING / admin / become-user / devMode), so
// static pages and the app zone can never disagree about who has app access.
//
// Hydration-safe by construction: useDesktopAccess starts with viewportWidth=0
// ('normal' → 'app'), matching the server markup; the real viewport is
// measured in an effect, so desktop visitors see a post-mount swap — the same
// pattern HeaderUserMenu already uses for its auth swap.

import {
  resolveRouteAccessCategory,
  type RouteAccessCategory,
} from '../../../application/policies/route-access.policy';
import { useAppRole } from '../../layouts/useAppRole';
import { useDesktopAccess } from '../../layouts/useDesktopAccess';

/**
 * 'app'     → this visitor can reach the logged-in app from this device:
 *             show login CTA / account dropdown / plan-aware pricing.
 * 'get-app' → desktop PREVIEW/PRODUCTION plain visitor: hide account UI,
 *             point every logged-action CTA at /get-app.
 */
export type AppEntryMode = 'app' | 'get-app';

export function useAppEntryMode(): AppEntryMode {
  const { isAdmin, isBecomeUser } = useAppRole();
  const decision = useDesktopAccess({ isAdmin, isBecomeUser });
  return decision === 'redirect' ? 'get-app' : 'app';
}

/**
 * Wave W3 (web-login-first): route-aware variant of `useAppEntryMode`.
 *
 * The blanket desktop bounce to /get-app is correct for PRODUCT routes (the
 * mobile-only app zone) but wrong for ACCOUNT routes — web login, onboarding
 * and billing must work on a desktop laptop for EVERYONE (owner decision).
 *
 * Behaviour by category (`resolveRouteAccessCategory(pathname)`):
 *   - 'account-route' → ALWAYS 'app'. Auth/billing/onboarding are first-class
 *                        on desktop; the get-app bounce is lifted here.
 *   - 'product-route' → unchanged: defers to the desktop-access cascade
 *                        ('get-app' on PREVIEW/PROD desktop plain user).
 *   - 'static'        → unchanged: same cascade as `useAppEntryMode`.
 *
 * Back-compat: `useAppEntryMode()` keeps its original (route-agnostic)
 * behaviour; callers opt into route awareness explicitly.
 */
export function useAppEntryModeForRoute(pathname: string): AppEntryMode {
  const { isAdmin, isBecomeUser } = useAppRole();
  const decision = useDesktopAccess({ isAdmin, isBecomeUser });
  const baseMode: AppEntryMode = decision === 'redirect' ? 'get-app' : 'app';
  const category: RouteAccessCategory = resolveRouteAccessCategory(pathname);
  // Account routes are exempt from the desktop get-app bounce — they ARE the
  // web-login surface. Product/static routes keep the base decision.
  return category === 'account-route' ? 'app' : baseMode;
}
