// main/src/application/auth/native-deeplink-listener.ts
// Warm-start login deep-link receiver (runs ONLY inside the native wrapper).
//
// WHY THIS EXISTS: the wrapper shell registers its own appUrlOpen listener, but
// that listener lives in the shell's bootstrap document and dies the moment the
// WebView navigates to this app — i.e. for the app's entire real life, inbound
// login deep links (a magic-link tap while the app is open, or the nailfolio://
// native-OAuth return hop) had NO receiver and silently expired. Cold start is
// NOT our concern: the shell consumes getLaunchUrl() before navigating here
// (Android emits appUrlOpen only from onNewIntent, never on cold launch).
// Capacitor retains an undelivered appUrlOpen natively, so a listener registered
// after the event fires still receives it — this covers the app-just-opening race.
//
// Pairs with the wrapper's src/lib/deeplink.ts (same URL shapes, same rules) and
// the backend bridge (web-1 auth-token-bridge). The frontend NEVER touches a
// session/provider token here — it only lands the document on a URL the existing
// AuthContext bootstrap already knows how to exchange (?authCode / verify chain).
//
// DECISION (nie usuwaj tego komentarza):
// s34 login-CSRF gate: a warm-start link goes through the SAME confirmation as
// a browser landing, with no code of its own here. handleInboundLoginUrl ends
// in a FULL document navigation, so AuthProvider re-mounts, snapshots the
// previous token and the "login started here" marker, exchanges, and holds the
// app behind "Logujesz się jako …" when needed (application/auth/login-confirmation.ts).
// Any app can fire appUrlOpen with an attacker's authCode, which is exactly why
// this path must never exchange in place: keep the navigation, do not add an
// in-document exchange shortcut.

import { PLATFORM_CONFIG } from '@kernel/domain/platform/platform.config';
import { isAppZonePath } from '@kernel/domain/routing/app-path.utils';

import { detectPlatform } from '../platform/platform.detection';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
import { bypassLeaveGuard } from '../routing/leave-guard';

let lastHandledKey: string | null = null;

// Segment-aware /app allowlist — `/app` or under `/app/`, NOT `/apple` — WITH an
// optional locale segment (`/en/app`, `/de/app/onboarding`): D6 carries the login
// language through the nailfolio:// hop, so `nailfolio://en/app?authCode=…`
// (host `en`, path `/app`) must land on `<origin>/en/app`. SSOT: kernel
// `isAppZonePath` (shared with web-1 native-oauth-start; the wrapper keeps a
// local copy of the same rule).
const isAppPath = (pathname: string): boolean => isAppZonePath(pathname);

/**
 * Redacted view of an inbound URL for logs — scheme/host/path + presence flags
 * ONLY, NEVER the authCode/token/query VALUES (single-use secrets).
 */
const redactInbound = (rawUrl: string): Record<string, unknown> => {
  try {
    const u = new URL(rawUrl);
    return {
      scheme: u.protocol,
      host: u.host,
      path: u.pathname,
      hasAuthCode: u.searchParams.has('authCode'),
      hasToken: u.searchParams.has('token'),
      hasCallbackURL: u.searchParams.has('callbackURL'),
    };
  } catch {
    return { scheme: '(unparseable)' };
  }
};

/**
 * Redacted log — never print token/authCode/full URL. Also ships to the
 * observability store at info level (gated by VERBOSE_LOG_MODE, docs/LOGGING.md)
 * so a device-side rejection is diagnosable without a debugger attached.
 */
const warnDeepLink = (reason: string): void => {
  console.warn(`[NativeDeepLink] inbound URL ignored: ${reason}`);
  reportIssueFrontend({
    namespace: 'NATIVE_DEEPLINK',
    message: `inbound ignored: ${reason}`,
    payload: null,
    mode: 'info',
  });
};

/**
 * Resolve an inbound deep-link URL to the absolute https landing URL this
 * document should navigate to, or null when it is not an actionable login link.
 *
 * Security: appUrlOpen can be fired by ANY app sending a VIEW intent, so every
 * https URL must target THIS document's own host (the origin that owns the
 * localStorage session), and the custom scheme is mapped onto that same origin.
 */
const resolveLandingUrl = (rawUrl: string): string | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    warnDeepLink('unparseable URL');
    return null;
  }

  // nailfolio://app[/…]?authCode=… (native OAuth-return hop) → same-origin https.
  if (`${url.protocol}//` === PLATFORM_CONFIG.DEEP_LINK_SCHEME) {
    if (!url.searchParams.get('authCode')) {
      warnDeepLink('scheme URL without authCode');
      return null;
    }
    // nailfolio://app/onboarding → host 'app', pathname '/onboarding';
    // nailfolio://en/app → host 'en', pathname '/app' (locale prefix, D6).
    const pathNoLead = `${url.host}${url.pathname}`.replace(/^\/+/, '');
    if (!isAppPath(`/${pathNoLead}`)) {
      warnDeepLink('scheme path outside /app allowlist');
      return null;
    }
    return `${window.location.origin}/${pathNoLead}${url.search}`;
  }

  if (url.protocol !== 'https:') {
    warnDeepLink('non-https, non-scheme URL');
    return null;
  }
  if (url.host !== window.location.host) {
    warnDeepLink('host is not this app origin');
    return null;
  }

  // Magic-link verify (or OAuth callback) App Link tapped while the app is open.
  const isVerifyLink =
    url.pathname.includes('/api/auth/magic-link/verify') ||
    url.pathname.includes('/api/auth/callback/');
  if (isVerifyLink) {
    // A verify WITHOUT callbackURL returns the raw session token as JSON —
    // refuse to top-level-navigate it. With callbackURL the in-document 302
    // chain lands on /app?authCode and AuthContext takes over.
    if (!url.searchParams.get('callbackURL')) {
      warnDeepLink('verify link without callbackURL');
      return null;
    }
    return url.toString();
  }

  // An already-bridged landing carrying ?authCode.
  if (url.searchParams.get('authCode')) {
    if (!isAppPath(url.pathname)) {
      warnDeepLink('authCode landing outside /app');
      return null;
    }
    return url.toString();
  }

  warnDeepLink('https URL with neither verify path nor authCode');
  return null;
};

/**
 * Handle one inbound appUrlOpen URL: validate, de-dupe on the single-use secret
 * (authCode / magic-link token — a double navigation would burn it twice), close
 * the external OAuth tab when the URL arrived via the custom scheme, and run a
 * FULL document navigation so AuthProvider re-mounts and re-reads ?authCode
 * (its exchange gate is a once-per-mount lazy init).
 */
const handleInboundLoginUrl = (rawUrl: string): boolean => {
  reportIssueFrontend({
    namespace: 'NATIVE_DEEPLINK',
    message: 'inbound appUrlOpen received',
    payload: redactInbound(rawUrl),
    mode: 'info',
  });

  const landing = resolveLandingUrl(rawUrl);
  if (landing === null) {
    return false;
  }

  const landingUrl = new URL(landing);
  const dedupeKey =
    landingUrl.searchParams.get('authCode') ??
    landingUrl.searchParams.get('token') ??
    landingUrl.toString();
  if (dedupeKey === lastHandledKey) {
    reportIssueFrontend({
      namespace: 'NATIVE_DEEPLINK',
      message: 'inbound skipped: single-use secret already handled (dedupe)',
      payload: null,
      mode: 'info',
    });
    return false;
  }
  lastHandledKey = dedupeKey;

  // Carry the platform marker: the landing may cross origins relative to where
  // the session began (sessionStorage is per-origin), so the URL param is the
  // only reliable way the next document knows it runs inside the wrapper.
  const { platform, isNativeApp } = detectPlatform();
  if (isNativeApp && !landingUrl.searchParams.has('platform')) {
    landingUrl.searchParams.set('platform', platform);
  }

  // Native-OAuth return came through an external browser tab (Custom Tab /
  // SFSafariViewController) — best-effort close it before navigating.
  if (
    rawUrl.trim().toLowerCase().startsWith(PLATFORM_CONFIG.DEEP_LINK_SCHEME)
  ) {
    void import('@capacitor/browser')
      .then(({ Browser }) => Browser.close())
      .catch(() => undefined);
  }

  reportIssueFrontend({
    namespace: 'NATIVE_DEEPLINK',
    message: 'inbound accepted → navigating WebView to landing',
    payload: redactInbound(landingUrl.toString()),
    mode: 'info',
  });

  // A system navigation that already decided (the login landed): a leave
  // guard's beforeunload prompt must not hold it (leave-guard.ts).
  bypassLeaveGuard();
  window.location.assign(landingUrl.toString());
  return true;
};

/**
 * Register the appUrlOpen listener (native platforms only). Call once from the
 * app lifecycle bootstrap. Web / missing plugin → silent no-op.
 */
export async function initNativeLoginDeepLinkListener(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    const capacitorNative = Capacitor.isNativePlatform();
    const detected = detectPlatform();

    // Permanent verbose instrumentation (info → VERBOSE_LOG_MODE, docs/LOGGING.md).
    // THE key native-login diagnostic: this listener arms ONLY on
    // Capacitor.isNativePlatform(), while the OAuth button (social-signin.ts) arms on
    // detectPlatform().isNativeApp (?platform= param). Inside the wrapper the two can
    // disagree (bridge not injected but ?platform present) → the button opens native
    // OAuth but the nailfolio:// return has NO receiver here. Log both so the split is
    // visible. Skip plain web visitors (neither signal) to avoid noise under verbose.
    if (capacitorNative || detected.isNativeApp) {
      reportIssueFrontend({
        namespace: 'NATIVE_DEEPLINK',
        message: `listener init: capacitorNative=${capacitorNative}, detectPlatform=${detected.platform}, detectNativeApp=${detected.isNativeApp}`,
        payload: {
          capacitorIsNative: capacitorNative,
          detect: detected,
          origin: typeof window !== 'undefined' ? window.location.origin : null,
        },
        mode: 'info',
      });
    }

    if (!capacitorNative) {
      return;
    }
    const { App } = await import('@capacitor/app');
    await App.addListener('appUrlOpen', ({ url }) => {
      handleInboundLoginUrl(url);
    });
    reportIssueFrontend({
      namespace: 'NATIVE_DEEPLINK',
      message: 'listener registered (appUrlOpen)',
      payload: null,
      mode: 'info',
    });
  } catch (error) {
    reportIssueFrontend({
      namespace: 'NATIVE_DEEPLINK',
      message: 'listener init failed',
      payload:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
      mode: 'info',
    });
  }
}
