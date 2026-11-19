// UI/shared/hooks/useAppEntryMode.ts
// Desktop app-entry mode for static-page chrome. The product is mobile-first, so on a desktop
// viewport in PREVIEW/PRODUCTION a plain visitor cannot USE the app; the navbar shows an
// "Otwórz na telefonie" affordance (HeaderUserMenu). useClientStartCta sends the main desktop
// CTA to web registration to avoid a get-app loop.
//
// NOT for conversion CTAs: signup/trial and pricing plan CTAs are ACCOUNT-route actions that
// enter the web-login funnel on EVERY viewport; they build the register/pay href directly (see
// pricingFunnelHref DECISION). Routing signup to /get-app dead-ends the desktop funnel.
//
// Reuses the `resolveDesktopAccess()` cascade that gates the /app zone (viewport < 1280 /
// DEVELOPMENT|STAGING / admin / become-user / devMode), so static pages and the app zone agree.
//
// Hydration-safe: useDesktopAccess starts with viewportWidth=0 ('normal' -> 'app'), matching the
// server markup; the viewport comes from an external store, so desktop visitors see a post-mount swap.

import {
  resolveRouteAccessCategory,
  type RouteAccessCategory,
} from '../../../application/policies/route-access.policy';
import { useAppRole } from '../../layouts/useAppRole';
import { useDesktopAccess } from '../../layouts/useDesktopAccess';

/**
 * 'app'     → this visitor can reach the logged-in app from this device:
 *             show login CTA / account dropdown / plan-aware pricing.
 * 'get-app' → desktop PREVIEW/PRODUCTION plain visitor: hide account UI and
 *             direct product actions to /get-app.
 */
export type AppEntryMode = 'app' | 'get-app';

export function useAppEntryMode(): AppEntryMode {
  const { isAdmin, isBecomeUser } = useAppRole();
  const decision = useDesktopAccess({ isAdmin, isBecomeUser });
  return decision === 'redirect' ? 'get-app' : 'app';
}

/**
 * Route-aware variant of `useAppEntryMode` (web-login-first).
 *
 * The blanket desktop bounce to /get-app is right for PRODUCT routes (the mobile-only app zone)
 * but wrong for ACCOUNT routes: web login, onboarding and billing must work on a desktop laptop
 * for EVERYONE (owner). By `resolveRouteAccessCategory(pathname)`:
 *   - 'account-route' -> ALWAYS 'app' (the get-app bounce is lifted).
 *   - 'product-route' -> defers to the desktop-access cascade ('get-app' for a PREVIEW/PROD
 *                        desktop plain user).
 *   - 'static'        -> same cascade as `useAppEntryMode`.
 * `useAppEntryMode()` stays route-agnostic; callers opt into route awareness.
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
