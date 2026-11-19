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
  // Reached ONLY by a top-level GET navigation from the external OAuth tab; any other method gets
  // the same opaque 404 as an unknown provider (enforced by the wrapper, not a 405).
  onMethodNotAllowed: res =>
    respondNotFound(
      res,
      APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
      undefined
    ),
  handle: async (req, res) => {
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
        `${resolveNativeLoginReturnUrl(locale, callbackURL)}&error=native_login_unavailable`
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
      const response = await auth.api.signInSocial({
        body: {
          provider,
          callbackURL,
          errorCallbackURL: resolveNativeLoginReturnUrl(locale, callbackURL),
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
        `${resolveNativeLoginReturnUrl(locale, callbackURL)}&error=oauth_init_failed`
      );
    }
  },
});

const resolveNativeLoginReturnUrl = (
  locale: string | null,
  callbackURL: string
): string =>
  `${buildFrontendBaseUrl()}${locale ? `/${locale}` : ''}${ROUTES_FRONT_STATIC.USER_LOG}?nativeAuth=1&from=${encodeURIComponent(resolveNativeErrorFrom(callbackURL))}`;

/**
 * WS1: the `from` the login screen gets back after a failed native sign-in, so
 * a retry still ends on the page she wanted. The validated callbackURL minus
 * the native marker (the login screen decides the channel again on retry).
 * Exported for unit tests.
 */
export const resolveNativeErrorFrom = (callbackURL: string): string => {
  const parsed = new URL(callbackURL, 'https://native.invalid');
  parsed.searchParams.delete('nativeAuth');
  return `${parsed.pathname}${parsed.search}`;
};
