// main/src/application/auth/social-signin.ts
// Social (Google/Apple) sign-in entrypoint, native-aware.
//
// Pairs with the backend native-OAuth return hop (web-1 auth-token-bridge
// toNativeOAuthReturnIfMarked) and the native shell's deep-link funnel. The
// frontend NEVER handles a provider/session token — it only starts the flow and,
// on native, opens the provider in an EXTERNAL browser tab.

import { authClient } from './better-auth-client';
import { detectPlatform } from '../platform/platform.detection';
import { buildBackendBaseUrl } from '../environment/backend-url';
import { openExternalUrl } from '../platform/browser';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
import { markLoginStarted } from './login-confirmation';
import type { AuthRedirectTargets } from './post-login-return';

export type SocialProvider = 'google' | 'apple';

// DECISION: provider-visibility SSOT, i.e. which social buttons the login UI shows when
// NEXT_PUBLIC_OAUTH_ENABLED is on. Apple is wired end to end but has no backend credentials yet
// (APPLE_* empty), so listing it would render a button that fails on click. Add 'apple' here once
// the credentials are set; this keeps the OAuth flag from ever exposing a dead provider button.
export const ENABLED_SOCIAL_PROVIDERS: readonly SocialProvider[] = ['google'];

export interface SocialSignInResult {
  /** Present on failure (already user-safe-ish; caller maps to i18n copy). */
  error?: string;
}

/**
 * D6 + WS1: the targets of `buildAuthRedirectTargets` (post-login-return.ts),
 * already localized. Web passes the ABSOLUTE `callbackURL` / `errorCallbackURL`
 * to Better Auth; native passes the RELATIVE `returnPath` to the backend start
 * endpoint, which validates it and builds its own absolute error exit.
 */
export type SocialSignInTarget = AuthRedirectTargets;

/**
 * Start social sign-in.
 *
 * WEB: Better Auth redirects the top-level window to the provider; the callback lands the browser on
 * `<frontend>/app?authCode` and the AuthContext exchange runs.
 *
 * NATIVE: Google rejects OAuth in embedded WebViews, so the flow runs in an EXTERNAL tab. We open the
 * backend GET wrapper `/api/auth/native-oauth-start/…` there (never a POST from the WebView), so
 * Better Auth's signed `state` cookie lands in the jar that receives the provider callback; starting
 * from the WebView ends in `state_mismatch`, and disabling the cookie check would remove login-CSRF
 * protection. The endpoint forces `callbackURL` to carry `nativeAuth=1`, so the bridge returns via
 * `nailfolio://` and the shell maps it to the https landing. The provider redirect_uri stays the
 * backend `/api/auth/callback/<provider>`; the custom scheme is NEVER registered with providers.
 */
export async function signInWithSocial(
  provider: SocialProvider,
  { returnPath, callbackURL, errorCallbackURL }: SocialSignInTarget
): Promise<SocialSignInResult> {
  const { isNativeApp } = detectPlatform();
  // Login-CSRF gate: stamp the start in THIS document's storage on both paths. Native: the OAuth
  // return lands back on this same WebView origin, so this marker is the one the exchange reads.
  markLoginStarted();

  try {
    if (isNativeApp) {
      const backendBaseUrl = buildBackendBaseUrl();
      if (!backendBaseUrl) {
        return { error: 'oauth_init_failed' };
      }
      // Open the initiation endpoint in the external browser (a top-level GET
      // navigation), NOT a WebView POST — see the doc comment above. The endpoint
      // sets the state cookie in the external browser and 302s to the provider.
      // The backend validates the path (locale-aware /app allowlist), appends
      // nativeAuth=1 and derives the localized error exit from the same value.
      const startUrl =
        `${backendBaseUrl}/api/auth/native-oauth-start/${provider}` +
        `?callbackURL=${encodeURIComponent(returnPath)}`;
      // Permanent verbose instrumentation (info → VERBOSE_LOG_MODE, docs/LOGGING.md).
      // Fires at TAP time (verbose reliably on), so it carries the platform-detection
      // divergence directly — no dependence on the mount-time 'listener init' log
      // (which races the verbose fetch). capacitorNative also reveals which path
      // openExternalUrl takes: true → @capacitor/browser Custom Tab, false → window.open
      // (system browser) AND the warm-start listener never arms (its gate). origin
      // confirms the loaded frontend host.
      let capacitorNative: boolean | null = null;
      try {
        const { Capacitor } = await import('@capacitor/core');
        capacitorNative = Capacitor.isNativePlatform();
      } catch {
        // @capacitor/core unavailable — leave null
      }
      reportIssueFrontend({
        namespace: 'NATIVE_DEEPLINK',
        message: `native OAuth button → opening external tab: provider=${provider}`,
        payload: {
          provider,
          isNativeApp,
          capacitorNative,
          origin: typeof window !== 'undefined' ? window.location.origin : null,
          hasBackendUrl: Boolean(backendBaseUrl),
        },
        mode: 'info',
      });
      // autoCloseOnReturn: dismiss the provider tab once the shell re-enters the
      // WebView on the nailfolio:// OAuth return, so repeated logins don't leave a
      // trail of orphaned browser tabs (the native return bypasses the tab's own JS).
      await openExternalUrl(startUrl, { autoCloseOnReturn: true });
      return {};
    }

    // Web: top-level redirect to the provider (no native marker, https return).
    // Absolute front URLs (DECISION in post-login-return.ts buildAuthRedirectTargets);
    // the front origin is in Better Auth's trustedOrigins (CORS allowlist SSOT).
    // The Better Auth client does not throw on a refused request: it resolves
    // `{ error }`. Ignoring it re-enabled the button with no message at all.
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL,
      errorCallbackURL,
    });
    if (error) {
      return { error: error.message ?? 'oauth_init_failed' };
    }
    return {};
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'oauth_init_failed',
    };
  }
}
