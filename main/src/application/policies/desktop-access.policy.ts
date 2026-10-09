/**
 * Desktop Access Policy (DDD)
 *
 * Single source of truth for deciding what an app-zone (`/app/*`) layout should
 * render on a non-mobile viewport. Replaces ad-hoc viewport checks scattered
 * across components.
 */
export type DesktopAccessDecision = 'frame' | 'redirect' | 'normal';

/** Manual environment buckets (mirrors `NEXT_PUBLIC_NODE_ENV_MANUAL`). */
export type ManualEnv = 'DEVELOPMENT' | 'STAGING' | 'PREVIEW' | 'PRODUCTION';

/** Desktop activation breakpoint (>= XL). Mirrors `tokens.css`. */
export const DESKTOP_FRAME_MIN_WIDTH = 1280;

export interface DesktopAccessContext {
  /** Current viewport width in CSS pixels (typically `window.innerWidth`). */
  viewportWidth: number;
  /** Manual environment bucket — DEVELOPMENT/STAGING get frame for testing. */
  manualEnv: ManualEnv;
  /** True when the current session is an admin account. */
  isAdmin: boolean;
  /**
   * True when an admin is impersonating another user via "become user".
   * Such a session must keep desktop access (admin tooling), even though the
   * effective role is non-admin.
   */
  isBecomeUser: boolean;
  /** Zustand `devMode` toggle — developer override. */
  isDevMode: boolean;
}

/**
 * Resolve the desktop access decision for an `/app/*` view.
 *
 * Rule cascade (first match wins):
 *   1. viewport <  XL                       → 'normal'   (phone/tablet, no frame)
 *   2. env = DEVELOPMENT | STAGING          → 'frame'    (testing in non-prod)
 *   3. admin role                           → 'frame'    (admin keeps desktop)
 *   4. become-user session (admin -> user)  → 'frame'    (preserve admin tooling)
 *   5. devMode toggle                       → 'frame'    (developer override)
 *   6. PREVIEW | PRODUCTION + plain user    → 'redirect' (point at /get-app)
 */
export function resolveDesktopAccess(
  ctx: DesktopAccessContext
): DesktopAccessDecision {
  // 1. Phone / tablet — no decision needed, render normally.
  if (ctx.viewportWidth < DESKTOP_FRAME_MIN_WIDTH) {
    return 'normal';
  }

  // 2. Non-production environments always get the frame for testing.
  if (ctx.manualEnv === 'DEVELOPMENT' || ctx.manualEnv === 'STAGING') {
    return 'frame';
  }

  // 3. Admin role — never redirect, always show frame.
  if (ctx.isAdmin) {
    return 'frame';
  }

  // 4. Become-user (admin impersonating) — preserve desktop access so the admin
  //    can switch back / keep using their tooling. Effective role may be
  //    non-admin but the session still belongs to an admin.
  if (ctx.isBecomeUser) {
    return 'frame';
  }

  // 5. Developer override (Zustand `devMode`).
  if (ctx.isDevMode) {
    return 'frame';
  }

  // 6. Default for PREVIEW / PRODUCTION + non-admin desktop user.
  return 'redirect';
}
