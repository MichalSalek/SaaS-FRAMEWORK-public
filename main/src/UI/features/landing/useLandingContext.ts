// SSOT for "what does the post-onboarding /app shell render on THIS device". The landing depends
// on the DEVICE CONTEXT, not on the account:
//   'admin-frame'    → admin / become-user / dev contexts keep the desktop phone-frame.
//   'lite-dashboard' → desktop >=1280 PREVIEW/PRODUCTION plain user: a trimmed account surface
//                      (plan / billing / settings + get-app module); the product itself stays
//                      mobile-only, but plan upgrade works here.
//   'full-product'   → phone / tablet (<1280) web OR the Android app (also the only product
//                      path for iOS, web-only).
// Reuses the `resolveDesktopAccess()` cascade that gates the /app zone.
//
// DECISION: hydration-safe by construction. `useDesktopAccess` starts with viewportWidth=0 ->
// 'normal', so the FIRST render (server + first CSR) resolves to 'full-product', matching the
// SSR markup; the real viewport is measured in an effect (a post-mount swap to 'lite-dashboard').
// Same pattern as useAppEntryMode / HeaderUserMenu; never branch on a width read during render.

import type { DesktopAccessDecision } from '../../../application/policies/desktop-access.policy';
import { useAppRole } from '../../layouts/useAppRole';
import { useDesktopAccess } from '../../layouts/useDesktopAccess';

export type LandingContext = 'admin-frame' | 'lite-dashboard' | 'full-product';

/**
 * Maps the desktop-access decision (the SSOT cascade) onto the landing context.
 *
 *   'frame'    → 'admin-frame'    (admin / become-user / dev / non-prod env)
 *   'redirect' → 'lite-dashboard' (desktop PREVIEW/PROD plain user)
 *   'normal'   → 'full-product'   (phone / tablet / app)
 *
 * Kept as a pure function (mirrors `resolveDesktopAccess`'s leaf-policy shape)
 * so the mapping is unit-test friendly and has no React/window coupling.
 */
function mapDecisionToContext(decision: DesktopAccessDecision): LandingContext {
  switch (decision) {
    case 'frame':
      return 'admin-frame';
    case 'redirect':
      return 'lite-dashboard';
    case 'normal':
      return 'full-product';
    default: {
      const _exhaustive: never = decision;
      return _exhaustive;
    }
  }
}

/**
 * Returns the live `LandingContext` for the current viewport + auth + env +
 * devMode. Re-renders on viewport resize and on devMode toggle (inherited from
 * `useDesktopAccess`).
 */
export function useLandingContext(): LandingContext {
  const { isAdmin, isBecomeUser } = useAppRole();
  const decision = useDesktopAccess({ isAdmin, isBecomeUser });
  return mapDecisionToContext(decision);
}
