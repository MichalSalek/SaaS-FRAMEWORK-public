import { randomBytes } from 'node:crypto';

import { PLATFORM_CONFIG } from '@kernel/domain/platform/platform.config';

import { CORS_ALLOWED_ORIGINS } from '@app/cors/cors.config';
import { ENV_VARS } from '@app/environment/environment.config';
import { IS_DEVELOPMENT_ENV } from '@app/environment/environment.utils.api';

/**
 * Minimal structural slice of Better Auth's `internalAdapter` used by the bridge.
 * Lets `mint`/`redeem` run from BOTH the auth after-hook (`ctx.context.internalAdapter`)
 * and a plain Next.js API route (`(await auth.$context).internalAdapter`) without
 * dragging the full `GenericEndpointContext` type into the Pages route.
 */
type VerificationRecord = {
  value: string;
  identifier: string;
  expiresAt: Date;
};
type VerificationStore = {
  createVerificationValue: (data: {
    identifier: string;
    value: string;
    expiresAt: Date;
  }) => Promise<VerificationRecord>;
  findVerificationValue: (
    identifier: string
  ) => Promise<VerificationRecord | null>;
  deleteVerificationByIdentifier: (identifier: string) => Promise<void>;
};

/**
 * Auth token bridge (variant C — exchange-code) — shared core for the
 * post-login token transport on magic-link verify + OAuth callback.
 *
 * WHY THIS EXISTS:
 *   Magic-link verify (`GET /api/auth/magic-link/verify`) and OAuth callbacks
 *   (`GET /api/auth/callback/{provider}`) mint a session, then issue a 302
 *   redirect to the (relative) callbackURL resolved against the BACKEND origin
 *   (`BETTER_AUTH_URL`). The frontend is a cookieless Bearer-only client
 *   (token in `localStorage['authorization']`, separate origin / Capacitor
 *   WebView). A top-level 302 navigation cannot surface the session token to
 *   the SPA — `set-auth-token` is unreadable by JS on a navigation, no
 *   `onSuccess` hook fires — so after a prod reload the user is logged out.
 *
 * THE BRIDGE:
 *   In the auth `hooks.after` we intercept the redirect, mint a one-time,
 *   short-lived (60 s) exchange CODE bound to the freshly-minted session
 *   token, and REWRITE the redirect `Location` to point at the FRONTEND
 *   origin with `?authCode=<code>` appended (NEVER the token itself). The
 *   SPA reads the code, POSTs it to `/api/auth/exchange-code` over XHR, and
 *   receives the long-lived bearer token back in the existing `authorization`
 *   response header — which the frontend http interceptor already persists to
 *   localStorage. The code is burned (deleted) on first exchange.
 *
 * SECURITY MODEL:
 *   - The long-lived bearer token NEVER touches a URL / browser history /
 *     server log. Only the ephemeral, single-use code does.
 *   - Code = 32 random bytes (hex) → 256 bits of entropy. Unguessable.
 *   - TTL = 60 s. Single-use: deleted (burned) on exchange. A code that is never
 *     redeemed (tab closed between the redirect and the XHR) is INERT once
 *     expired — `redeemExchangeCode` enforces the TTL on every lookup. Better
 *     Auth's internalAdapter exposes no expired-row cleanup, so orphan rows
 *     (abandoned logins) are swept by `exchange-code-cleanup.interceptor.ts`:
 *     a throttled (24h) deleteMany on the `xchg:` prefix with `expiresAt < now`.
 *   - Storage reuses Better Auth's `internalAdapter` Verification table with a
 *     dedicated `xchg:` identifier prefix (no collision with magic-link tokens,
 *     which store JSON under the raw token, or the one-time-token plugin's
 *     `one-time-token:` prefix). Zero schema migration.
 */

// DECISION (nie usuwaj tego komentarza):
// Prefix `xchg:` izoluje exchange-code od pozostałych wpisów w tabeli
// Verification (magic-link trzyma JSON pod surowym hashem tokenu; one-time-token
// plugin pod `one-time-token:`). Bez prefiksu lookup mógłby przypadkiem trafić w
// magic-link token. Prefix = namespace, NIE sekret — sekretem jest 256-bitowy code.
// Exported as SSOT: the orphan-row cleanup sweep (exchange-code-cleanup.interceptor.ts)
// reuses this exact prefix — never re-hardcode 'xchg:' anywhere else.
export const EXCHANGE_CODE_PREFIX = 'xchg:';

// 60 s — wystarcza na top-level redirect + bootstrap SPA + 1 XHR. Krótko, bo
// code żyje w URL/historii do momentu scrubu przez front; im krócej tym lepiej.
const EXCHANGE_CODE_TTL_MS = 60 * 1000;

const exchangeIdentifier = (code: string): string =>
  `${EXCHANGE_CODE_PREFIX}${code}`;

/**
 * Mint a single-use exchange code bound to a session token.
 * Stored in the Verification table via Better Auth's internal adapter.
 */
export const mintExchangeCode = async (
  store: VerificationStore,
  sessionToken: string
): Promise<string> => {
  const code = randomBytes(32).toString('hex');
  await store.createVerificationValue({
    identifier: exchangeIdentifier(code),
    value: sessionToken,
    expiresAt: new Date(Date.now() + EXCHANGE_CODE_TTL_MS),
  });
  return code;
};

/**
 * Redeem an exchange code: look it up, BURN it (single-use), validate TTL, and
 * return the bound session token. Returns `null` for any failure mode
 * (unknown / expired / malformed) WITHOUT distinguishing them — the caller
 * MUST NOT leak whether a code existed.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Burn-before-validate (delete najpierw, potem sprawdź expiry) — gwarantuje
 * single-use nawet dla wygasłego-ale-jeszcze-obecnego wpisu: każdy redeem
 * konsumuje code raz. Race dwóch równoległych POST-ów z tym samym code: oba
 * czytają ten sam wiersz, oba usuwają (idempotentny delete), oba dostają token
 * — ale to ten SAM token tej SAMEJ sesji (nie eskalacja); realnie i tak tylko
 * jeden XHR leci z SPA. Brak okna na wymianę code na DWIE różne sesje.
 * Cały lookup/delete owinięty w try-catch zwracający `null` na KAŻDY wyjątek
 * (np. błąd DB w internalAdapter): kolaps DB-error do tego samego opaque-null
 * co not-found/expired/malformed. Bez tego rzut z adaptera dałby 500 z
 * exchange-code endpointu (vs 404 dla nieistniejącego code) → rozróżnialny
 * info-leak "czy ten code istnieje". Jednolity null = jednolity 404.
 */
export const redeemExchangeCode = async (
  store: VerificationStore,
  code: string
): Promise<string | null> => {
  if (!code || typeof code !== 'string') {
    return null;
  }
  try {
    const identifier = exchangeIdentifier(code);
    const record = await store.findVerificationValue(identifier);
    if (!record) {
      return null;
    }
    // Single-use: burn immediately, regardless of validity outcome below.
    await store.deleteVerificationByIdentifier(identifier);
    if (record.expiresAt < new Date()) {
      return null;
    }
    return typeof record.value === 'string' && record.value
      ? record.value
      : null;
  } catch {
    return null;
  }
};

/**
 * Rewrite a redirect `Location` to carry the exchange code on the FRONTEND
 * origin.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Origin selection (dev vs prod safe):
 *   - Better Auth resolved the redirect against BACKEND origin (BETTER_AUTH_URL).
 *     W DEV BETTER_AUTH_URL bywa już portem frontu (:3000) — host trafia wtedy
 *     w CORS_ALLOWED_ORIGINS (frontend allow-list) → ZACHOWUJEMY origin (żeby nie
 *     przełączyć localhost↔LAN-IP i nie zerwać sesji startniętej na danym hoście).
 *   - W PROD host = backend (backend.example.com) — NIE ma go w froncie →
 *     PODMIENIAMY origin na kanoniczny frontend (resolveCanonicalFrontendOrigin,
 *     np. https://nailfolio.app), zachowując pathname+search z oryginalnego callbackURL.
 * Path (np. /app, /app/onboarding?role=stylist) jest zawsze zachowany — to
 * miejsce docelowe wybrane przez front w callbackURL.
 */
export const buildBridgeRedirectUrl = (
  currentLocation: string,
  code: string
): string => {
  let target: URL;
  try {
    target = new URL(currentLocation);
  } catch {
    // Relative / malformed Location: fall back to canonical frontend origin and
    // treat the raw value as a path.
    target = new URL(
      currentLocation || '/',
      withTrailingSlashStripped(resolveCanonicalFrontendOrigin())
    );
  }

  const currentOrigin = `${target.protocol}//${target.host}`;
  const isFrontendHost = CORS_ALLOWED_ORIGINS.includes(currentOrigin);

  if (!isFrontendHost) {
    const frontend = new URL(resolveCanonicalFrontendOrigin());
    target.protocol = frontend.protocol;
    target.host = frontend.host;
  }

  target.searchParams.set('authCode', code);
  return target.toString();
};

/**
 * Canonical single frontend origin (first FRONTEND_PUBLIC_DOMAIN + port).
 * Dev uses http (localhost / LAN-IP); prod uses https.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Budujemy origin SAMODZIELNIE (nie przez buildFrontendBaseUrl) bo
 * FRONTEND_PUBLIC_DOMAIN bywa listą (dev: `localhost, 192.168.0.10`) — bierzemy
 * PIERWSZY wpis. Protokół: http w dev (localhost / LAN-IP po http), https na prod.
 * Ten origin to FALLBACK używany TYLKO gdy bieżący host redirectu nie jest
 * frontendem (prod: backend→front swap); w dev host zwykle już pasuje i origin
 * jest zachowany 1:1.
 */
export const resolveCanonicalFrontendOrigin = (): string => {
  // DECISION (nie usuwaj): env-driven origin fallback, nie brand-identity —
  // 'nailfolio.app' to bezpieczny default dla FRONTEND_PUBLIC_DOMAIN przy
  // budowie origin/redirectu (transport). Operator zmienia przez env bez deployu,
  // więc NIE kolapsujemy tego do BRAND_CONFIG (patrz brand.config.ts §DECISION).
  const firstDomain =
    (ENV_VARS.FRONTEND_PUBLIC_DOMAIN || 'nailfolio.app')
      .split(',')
      .map(d => d.trim())
      .filter(Boolean)[0] ?? 'nailfolio.app';
  const port = ENV_VARS.FRONTEND_PUBLIC_PORT
    ? ENV_VARS.FRONTEND_PUBLIC_PORT.split(',')[0]?.trim()
    : '';
  const protocol = IS_DEVELOPMENT_ENV() ? 'http' : 'https';
  return port
    ? `${protocol}://${firstDomain}:${port}`
    : `${protocol}://${firstDomain}`;
};

const withTrailingSlashStripped = (origin: string): string =>
  origin.endsWith('/') ? origin.slice(0, -1) : origin;

/**
 * Native-originated OAuth marker. The frontend's native social sign-in sets
 * `callbackURL=/app?nativeAuth=1` (relative -> passes originCheckMiddleware).
 * Better Auth preserves it through the provider round-trip, so it reappears in
 * the bridge's rewritten landing URL search.
 */
export const NATIVE_OAUTH_MARKER = 'nativeAuth';

/**
 * If the (already frontend-rewritten) https landing URL carries the native-OAuth
 * marker, strip the marker and return the `nailfolio://` custom-scheme RETURN
 * URL; otherwise return null.
 *
 * WHY a scheme and not the https Universal/App Link for OAuth return: native
 * OAuth runs in an EXTERNAL browser tab (SFSafariViewController / Chrome Custom
 * Tab — Google rejects OAuth in embedded WebViews with disallowed_useragent).
 * Those tabs do NOT honor Universal/App Links on an internal 302, so the only
 * reliable hand-back to the app is a custom scheme the tab cannot itself load.
 * The native shell's deep-link funnel maps `nailfolio://app?authCode=…` back to
 * `https://<frontend>/app?authCode=…` and runs the EXISTING exchange-code flow
 * (no token logic is duplicated, and only the https channel ever reaches
 * /api/auth/exchange-code). Magic-link does NOT use this path — its first tap is
 * already an OS-verified Universal/App Link.
 *
 * Caller MUST gate on ENV_VARS.NATIVE_DEEPLINK_ENABLED and an OAuth `/callback`
 * path. Mapping: origin -> scheme, pathname (sans leading slash) -> scheme
 * host+path, authCode preserved. e.g.
 *   https://nailfolio.app/app?authCode=abc            -> nailfolio://app?authCode=abc
 *   https://nailfolio.app/app/onboarding?authCode=abc -> nailfolio://app/onboarding?authCode=abc
 */
export const toNativeOAuthReturnIfMarked = (
  httpsLandingUrl: string
): string | null => {
  let target: URL;
  try {
    target = new URL(httpsLandingUrl);
  } catch {
    return null;
  }
  if (target.searchParams.get(NATIVE_OAUTH_MARKER) !== '1') {
    return null;
  }
  target.searchParams.delete(NATIVE_OAUTH_MARKER);
  const pathNoLead = target.pathname.replace(/^\/+/, '') || 'app';
  return `${PLATFORM_CONFIG.DEEP_LINK_SCHEME}${pathNoLead}${target.search}`;
};
