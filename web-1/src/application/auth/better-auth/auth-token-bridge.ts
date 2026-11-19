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
  consumeVerificationValue: (
    identifier: string
  ) => Promise<VerificationRecord | null>;
};

/**
 * DECISION: magic-link verify and OAuth mint a session, then 302 to a callbackURL on the
 * API origin. The front is cookieless Bearer (`localStorage['authorization']`), and a
 * top-level 302 cannot hand it the token. `hooks.after` mints a one-time 60s code, rewrites
 * Location to the front origin with `?authCode` (never the token), and the SPA exchanges
 * the code for the bearer header. The code is deleted on redeem; orphan rows are swept.
 */

// DECISION: the `xchg:` prefix isolates exchange codes from other Verification rows (magic-link
// keeps JSON under the raw token hash, the one-time-token plugin uses `one-time-token:`); without
// it a lookup could hit a magic-link token. The prefix is a namespace, NOT a secret (the secret is
// the 256-bit code). Exported as SSOT: the orphan-row cleanup sweep
// (exchange-code-cleanup.interceptor.ts) reuses it; never re-hardcode 'xchg:' elsewhere.
export const EXCHANGE_CODE_PREFIX = 'xchg:';

// 60 s covers a top-level redirect + SPA bootstrap + 1 XHR. Short because the code lives in the
// URL/history until the front scrubs it.
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
 * Redeem an exchange code. One caller receives the session token. Every other
 * outcome is `null` (missing, expired, malformed, adapter error), with no
 * distinction the caller could use to learn whether the code existed.
 * DECISION: burn via Better Auth `consumeVerificationValue` (Prisma `consumeOne`
 * deletes by id and returns the row, or null). find + delete-by-identifier is
 * void, so two waiters both returned the token. A past `expiresAt` is null here
 * too; the library also deletes that row and returns null. Test:
 * auth-token-bridge.redeem.test.ts (barrier; not Postgres) and
 * tests/postgres/auth-token-bridge.pg.test.ts (two processes, one FOR UPDATE;
 * Prisma, no secondary storage, adapter transactions left off).
 */
export const redeemExchangeCode = async (
  store: VerificationStore,
  code: string
): Promise<string | null> => {
  if (!code || typeof code !== 'string') {
    return null;
  }
  try {
    const record = await store.consumeVerificationValue(
      exchangeIdentifier(code)
    );
    if (!record || record.expiresAt < new Date()) {
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
 * DECISION: origin selection is dev/prod safe. Better Auth resolves the redirect against the
 * BACKEND origin (BETTER_AUTH_URL).
 *   - In dev BETTER_AUTH_URL is often already the front port (:3000), so the host is in
 *     CORS_ALLOWED_ORIGINS (frontend allow-list) and the origin is KEPT, so localhost<->LAN-IP is
 *     not switched and a session started on that host survives.
 *   - In prod the host is the backend (backend.example.com), not a frontend, so the origin
 *     is REPLACED with the canonical frontend (resolveCanonicalFrontendOrigin, e.g.
 *     https://nailfolio.app), keeping pathname+search of the original callbackURL.
 * The path (e.g. /app, /app/onboarding?role=stylist) is always kept: it is the destination the
 * front chose in callbackURL.
 */
export const buildBridgeRedirectUrl = (
  currentLocation: string,
  code: string
): string => {
  const target = new URL(pinRedirectToFrontendOrigin(currentLocation));
  target.searchParams.set('authCode', code);
  return target.toString();
};

/**
 * A redirect `Location` moved onto a FRONTEND origin, path + query kept: an
 * origin already in CORS_ALLOWED_ORIGINS stays (dev localhost / LAN-IP), any
 * other http(s) origin (the API itself) and a relative / malformed value get the
 * canonical frontend origin. Shared by the success bridge above and the failure
 * net in auth-redirect-targets.ts. A non-http scheme (`nailfolio://`) is left as
 * is: the native return hop is chosen on purpose, after this step.
 */
export const pinRedirectToFrontendOrigin = (
  currentLocation: string
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
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return currentLocation;
  }

  if (!isFrontendOrigin(`${target.protocol}//${target.host}`)) {
    const frontend = new URL(resolveCanonicalFrontendOrigin());
    target.protocol = frontend.protocol;
    target.host = frontend.host;
  }
  return target.toString();
};

/** True for an origin in the frontend allowlist (CORS SSOT). */
export const isFrontendOrigin = (origin: string): boolean =>
  CORS_ALLOWED_ORIGINS.includes(origin);

/**
 * Canonical single frontend origin (first FRONTEND_PUBLIC_DOMAIN + port).
 * Dev uses http (localhost / LAN-IP); prod uses https.
 *
 * DECISION: the origin is built here, NOT through buildFrontendBaseUrl, because
 * FRONTEND_PUBLIC_DOMAIN can be a list (dev: `localhost, 192.168.0.10`) and the FIRST entry is
 * used. Protocol: http in dev, https in prod. This origin is only a FALLBACK for when the
 * redirect's current host is not a frontend (prod backend->front swap); in dev the host usually
 * already matches and is kept 1:1.
 */
export const resolveCanonicalFrontendOrigin = (): string => {
  // DECISION: env-driven origin fallback, not brand identity: 'nailfolio.app' is a safe default
  // for FRONTEND_PUBLIC_DOMAIN (transport). Operators change it via env without a deploy, so it is
  // NOT collapsed into BRAND_CONFIG (nf/brand-literals allowlists this file).
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
 * marker, strip it and return the `nailfolio://` custom-scheme RETURN URL; else null.
 *
 * WHY a scheme and not the https App Link: native OAuth runs in an EXTERNAL browser
 * tab (Google rejects embedded WebViews) that does NOT honor App Links on an internal
 * 302. The shell's deep-link funnel maps `nailfolio://app?authCode=...` back to
 * `https://<frontend>/app?authCode=...` and runs the exchange-code flow.
 *
 * Caller MUST gate on ENV_VARS.NATIVE_DEEPLINK_ENABLED and an OAuth `/callback` path.
 * Mapping: origin -> scheme, pathname (sans leading slash) -> scheme host+path, e.g.
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
