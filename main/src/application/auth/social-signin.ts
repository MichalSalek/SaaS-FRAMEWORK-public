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

export type SocialProvider = 'google' | 'apple';

// DECISION (nie usuwaj tego komentarza):
// Provider-visibility SSOT: which social buttons the login UI surfaces when
// NEXT_PUBLIC_OAUTH_ENABLED is on. Google ships first; Apple is wired end-to-end
// (button + flow + backend exchange-code bridge) but has NO backend creds yet
// (APPLE_* empty), so listing it would render a button that fails on click. Add
// 'apple' here once Apple Developer + Sign in with Apple creds are set — this keeps
// flipping the OAuth flag from ever exposing a dead provider button.
export const ENABLED_SOCIAL_PROVIDERS: readonly SocialProvider[] = ['google'];

export interface SocialSignInResult {
  /** Present on failure (already user-safe-ish; caller maps to i18n copy). */
  error?: string;
}

export interface SocialSignInTarget {
  /**
   * D6: post-login landing, ALREADY localized by `resolveLocalizedReturnPath`
   * (`/en/app/onboarding?role=stylist`). The same funnel target the magic-link
   * flow uses — Google used to send a bare `/app` and dropped both the locale and
   * the onboarding role hint.
   */
  returnPath: string;
  /** D6: localized login path for provider/state failures (`/en/user/login`). */
  errorReturnPath: string;
}

/**
 * Start social sign-in.
 *
 * WEB: let Better Auth redirect the top-level window to the provider; the OAuth
 * callback → token bridge lands the browser on `<frontend>/app?authCode` and the
 * existing AuthContext exchange runs.
 *
 * NATIVE: Google rejects OAuth inside embedded WebViews (disallowed_useragent),
 * so the provider flow runs in an EXTERNAL tab (SFSafariViewController / Chrome
 * Custom Tab via @capacitor/browser). Crucially we do NOT initiate the flow from
 * the WebView — we open the backend GET-wrapper `/api/auth/native-oauth-start/…`
 * directly in that external tab, so Better Auth's signed `state` cookie is stored
 * in the SAME browser jar that later receives the provider callback. Initiating
 * from the WebView (a POST) would strand the state cookie in the WebView's jar
 * while the callback lands in the external browser → `state_mismatch`; the only
 * alternative (disabling the cookie check) would strip OAuth login-CSRF
 * protection from every sign-in. The backend endpoint 302s to the provider and
 * forces `callbackURL` to carry `nativeAuth=1`, so the backend bridge returns via
 * the `nailfolio://` custom scheme (the only reliable OAuth-return primitive for
 * an external tab); the native shell maps it back to the https landing and the
 * existing exchange-code flow runs. PKCE/state are owned by Better Auth server-side.
 *
 * The provider redirect_uri stays the backend `/api/auth/callback/<provider>`
 * (registered with Google/Apple) — the custom scheme is NEVER registered with the
 * providers.
 */
export async function signInWithSocial(
  provider: SocialProvider,
  { returnPath, errorReturnPath }: SocialSignInTarget
): Promise<SocialSignInResult> {
  const { isNativeApp } = detectPlatform();
  // s34 login-CSRF gate: stamp the start in THIS document's storage on both
  // paths. Native: the OAuth return lands (via nailfolio://) back on this same
  // WebView origin, so the marker set here is the one the exchange reads, even
  // though the provider flow itself runs in an external tab.
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
    // Relative, locale-prefixed paths pass Better Auth's originCheck
    // (`isTrustedOrigin(url, { allowRelativePaths: true })`).
    // The Better Auth client does not throw on a refused request: it resolves
    // `{ error }`. Ignoring it re-enabled the button with no message at all.
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: returnPath,
      errorCallbackURL: errorReturnPath,
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
