import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  ROUTES_FRONT_APP,
  ROUTES_FRONT_STATIC,
} from '@kernel/domain/routing/routing.config';
import {
  isAppZonePath,
  readLocalePrefix,
} from '@kernel/domain/routing/app-path.utils';

import { auth } from '@app/auth/better-auth/better-auth.config';
import { ENV_VARS } from '@app/environment/environment.config';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { withPublicHandler } from '@app/http/define-raw-handler';
import { respondNotFound } from '@app/http/http.responses.utils';

/**
 * GET /api/auth/native-oauth-start/:provider — native OAuth initiation.
 *
 * WHY THIS ENDPOINT EXISTS (the state-cookie-jar problem):
 *   Google/Apple reject OAuth inside embedded WebViews, so the native app runs
 *   the provider flow in an EXTERNAL browser tab (Custom Tab / SFSafariViewController).
 *   Better Auth binds each OAuth flow to its initiator with a signed `state`
 *   cookie (SameSite=Lax) — the ONLY defense against OAuth login-CSRF / session
 *   fixation (a single-use DB state does NOT prove the browser completing the
 *   callback started the flow). If the app initiated the flow from the WebView
 *   (POST /sign-in/social), that cookie would land in the WebView's cookie jar,
 *   while the provider callback lands in the EXTERNAL browser's jar — cookie
 *   absent → hard `state_mismatch`. Disabling the cookie check globally would
 *   strip login-CSRF protection from EVERY sign-in, web included.
 *
 *   Fix: initiate the flow HERE, reached by a top-level GET navigation the native
 *   app opens IN the external browser. `signInSocial` sets the `state` cookie on
 *   THIS response, so it lands in the external browser — the same jar that later
 *   receives the provider callback. The cookie check stays intact for everyone;
 *   no `skipStateCookieCheck`. Pairs with main/ social-signin.ts (native branch)
 *   and the backend bridge (auth-token-bridge `toNativeOAuthReturnIfMarked`).
 *
 * Contract:
 *   GET /api/auth/native-oauth-start/google?callbackURL=/app
 *   success: 302 → provider authorize URL, `Set-Cookie: <state cookie>`.
 *   The callbackURL is forced to carry `nativeAuth=1` so the post-callback bridge
 *   returns control via the `nailfolio://` scheme (an external tab cannot follow a
 *   Universal/App Link on a 302). Relative-only (open-redirect guard).
 *
 * Gated on NATIVE_DEEPLINK_ENABLED (mirrors the bridge). This flag is the runtime
 * KILL-SWITCH for native deep-link login; NEXT_PUBLIC_OAUTH_ENABLED (build-time,
 * frontend) only controls whether the social buttons render. The two are in
 * different planes and can diverge (app shipped with the button while the backend
 * flag is flipped off in an incident). So when the flag is OFF this endpoint does
 * NOT hard-404 into the external tab — it 302s to the frontend login page, where
 * the user lands on a real screen and can use magic-link. Native OAuth genuinely
 * cannot complete with the flag off (the nailfolio:// return hop is gated off with
 * it), so graceful degradation — never a crash — is the correct kill-switch shape.
 * Method / unknown-provider rejections stay opaque 404 (security, not user-facing).
 */

const ALLOWED_PROVIDERS = ['google', 'apple'] as const;
type AllowedProvider = (typeof ALLOWED_PROVIDERS)[number];

const isAllowedProvider = (value: unknown): value is AllowedProvider =>
  typeof value === 'string' &&
  (ALLOWED_PROVIDERS as readonly string[]).includes(value);

/**
 * Force the landing to a relative /app path carrying nativeAuth=1. Rejects any
 * absolute / protocol-relative / non-/app value (open-redirect + scope guard) —
 * falls back to the bare /app landing rather than trusting attacker input.
 *
 * D6 (2026-09-05): a locale-prefixed app path (`/en/app`, `/de/app/onboarding`)
 * is IN scope — the front sends the return path in the user's login language and
 * the bridge / nailfolio:// hop / deep-link listeners carry the prefix through
 * (SSOT of the allowlist: kernel `isAppZonePath`). Exported for unit tests.
 */
export const resolveNativeCallbackURL = (raw: unknown): string => {
  const fallback = `${ROUTES_FRONT_APP.APP}?nativeAuth=1`;
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) {
    return fallback;
  }
  // Parse against a dummy origin to normalize path + reject anything off /app.
  let parsed: URL;
  try {
    parsed = new URL(raw, 'https://native.invalid');
  } catch {
    return fallback;
  }
  if (!isAppZonePath(parsed.pathname)) {
    return fallback;
  }
  parsed.searchParams.set('nativeAuth', '1');
  return `${parsed.pathname}${parsed.search}`;
};

export default withPublicHandler({
  allowedMethods: ['GET'],
  // cors:false — this is a top-level browser NAVIGATION opened in the external
  // OAuth tab, NOT a same-origin SPA XHR. A top-level GET nav carries no Origin
  // header, so an allow-list would only 406 the legitimate flow (same rationale
  // as the S2S endpoints). Rate-limit stays on via the /api/auth/ strict bucket.
  cors: false,
  handle: async (req, res) => {
    // Method gate stays HERE — withPublicHandler's allowedMethods is a docs/ratchet
    // hint with no runtime effect (raw handlers own method gating). This endpoint is
    // reached ONLY by a top-level GET navigation from the external OAuth tab; reject
    // anything else with the same opaque 404 as an unknown provider.
    if (req.method !== 'GET') {
      respondNotFound(
        res,
        APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
        undefined
      );
      return;
    }

    // D6: every exit (success landing, kill-switch, init failure) keeps the
    // language the user started from — the locale is read once from the
    // VALIDATED callbackURL (open-redirect guard runs first), never from raw input.
    const callbackURL = resolveNativeCallbackURL(req.query.callbackURL);
    const locale = readLocalePrefix(callbackURL);

    // Kill-switch OFF → native OAuth is genuinely unavailable (the nailfolio://
    // return is gated off with this flag). Degrade gracefully: send the external
    // tab to the frontend login page (magic-link works there) instead of a dead
    // 404. See the header comment for the two-flag (build-time vs runtime) design.
    if (!ENV_VARS.NATIVE_DEEPLINK_ENABLED) {
      res.redirect(
        302,
        `${resolveNativeLoginReturnUrl(locale)}&error=native_login_unavailable`
      );
      return;
    }

    const provider = Array.isArray(req.query.provider)
      ? req.query.provider[0]
      : req.query.provider;
    if (!isAllowedProvider(provider)) {
      respondNotFound(
        res,
        APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
        undefined
      );
      return;
    }

    try {
      // Server-side sign-in: generates state (+ signed state cookie on THIS
      // response) and the provider authorize URL. disableRedirect → the URL comes
      // back in the JSON body; we forward the Set-Cookie(s) and 302 ourselves so
      // the state cookie is stored in the external browser before it hits Google.
      //
      // errorCallbackURL is passed as an ABSOLUTE frontend URL on purpose. Better
      // Auth stores it as the state's errorURL VERBATIM (no origin resolution), so a
      // RELATIVE value would land a post-consent OAuth error on the BACKEND origin
      // (api.nailfolio.app/app…) — a dead page in the external tab. The absolute
      // login URL carries `nativeAuth=1`, which is what makes a FAILED native
      // sign-in recoverable: the login screen rendered in the external tab reads the
      // marker and offers an explicit `nailfolio://app` way back, plus the `?error=`
      // code Better Auth appends is turned into a readable sentence there. Before
      // this (incident 2026-08-17) a failure inherited the global onAPIError.errorURL:
      // the same login page, but with no marker and no error copy — the user was
      // dropped on a silent login form in a browser tab while the app sat orphaned
      // in the background. Success still returns through the bridge's nailfolio://
      // hop (newSession path), untouched by this.
      const response = await auth.api.signInSocial({
        body: {
          provider,
          callbackURL,
          errorCallbackURL: resolveNativeLoginReturnUrl(locale),
          disableRedirect: true,
        },
        asResponse: true,
      });

      const data = (await response.json()) as { url?: unknown };
      const url = typeof data.url === 'string' ? data.url : null;
      if (!url) {
        throw new Error('signInSocial returned no authorize URL');
      }

      const setCookies = response.headers.getSetCookie();
      if (setCookies.length > 0) {
        res.setHeader('Set-Cookie', setCookies);
      }

      // Permanent verbose instrumentation (info → gated by VERBOSE_LOG_MODE, see
      // docs/LOGGING.md). Confirms the external-tab entry point ran and the state
      // cookie was set on THIS response (cookies>0). No token/code/URL logged.
      reportIssueBackend({
        namespace: 'AUTH_NATIVE_OAUTH_START',
        message: `native OAuth initiated: provider=${provider}, stateCookies=${setCookies.length}`,
        payload: {
          provider,
          deeplinkEnabled: ENV_VARS.NATIVE_DEEPLINK_ENABLED,
          stateCookieSet: setCookies.length > 0,
        },
        mode: 'info',
      });

      res.redirect(302, url);
    } catch (error) {
      reportIssueBackend({
        namespace: 'AUTH_NATIVE_OAUTH_START',
        message: 'Failed to initiate native OAuth flow',
        payload: error,
        mode: 'error',
      });
      // Fail into the frontend login screen rather than a backend-origin 404.
      res.redirect(
        302,
        `${resolveNativeLoginReturnUrl(locale)}&error=oauth_init_failed`
      );
    }
  },
});

/**
 * Frontend login URL for every failure exit of the native flow, tagged with the
 * `nativeAuth=1` marker. Reuses the canonical `buildFrontendBaseUrl()` resolver
 * (multi-value dev domains + optional FRONTEND_PUBLIC_PORT) instead of a local
 * copy of the origin-fallback literal (ratchet audit:brand-literals).
 *
 * The marker is what tells the login screen it is being rendered inside the
 * external OAuth tab, so it can offer the `nailfolio://app` hand-back instead of
 * leaving the user to back out of the browser (incident 2026-08-17). Callers
 * appending their own code use `&error=…` — the query already exists here.
 *
 * D6: `locale` (from the validated callbackURL) prefixes the login path so a failed
 * native sign-in started from `/en/…` explains itself in English, not Polish.
 * The default locale stays unprefixed (Next canonical).
 */
const resolveNativeLoginReturnUrl = (locale: string | null = null): string =>
  `${buildFrontendBaseUrl()}${locale ? `/${locale}` : ''}${ROUTES_FRONT_STATIC.USER_LOG}?nativeAuth=1`;
