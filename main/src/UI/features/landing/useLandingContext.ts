// UI/features/landing/useLandingContext.ts
//
// SPE (W5): SSOT for "what does the post-onboarding /app shell render on THIS
// device". The landing after onboarding depends on the DEVICE CONTEXT, not on
// the account:
//
//   'admin-frame'    → admin / become-user / dev contexts keep the existing
//                      desktop phone-frame (admin tooling, QA, dev override).
//   'lite-dashboard' → desktop >=1280 PREVIEW/PRODUCTION plain user: a trimmed
//                      account surface (plan / billing / settings + get-app
//                      module). The product itself (galleries, feed) stays
//                      mobile-only — but plan upgrade DOES work here.
//   'full-product'   → phone / tablet (<1280) web OR the Android app: the full
//                      mobile product. This is also the ONLY product access path
//                      for iOS (web-only, no native iOS app).
//
// Reuses the exact `resolveDesktopAccess()` cascade that gates the /app zone, so
// the lite-dashboard and the product zone can never disagree about who is on a
// desktop.
//
// DECISION (nie usuwaj tego komentarza):
// Hydration-safe by construction. `useDesktopAccess` starts with viewportWidth=0
// → 'normal', so the FIRST render (server + first CSR) always resolves to
// 'full-product' — matching the SSR markup. The real viewport is measured in an
// effect, so a desktop visitor sees a post-mount swap to 'lite-dashboard'. This
// is the same swap pattern useAppEntryMode / HeaderUserMenu already use; never
// branch the tree on a width read taken during render.

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
