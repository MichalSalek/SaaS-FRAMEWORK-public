/**
 * DECISION: Better Auth resolves a relative callbackURL against the API origin, so a
 * failure redirect landed on the API 404. The front sends absolute targets, but cached
 * bundles and already-sent magic links still carry relative ones. `normalizeAuthRedirectTargets`
 * (before) absolutizes a safe relative target onto the request's front origin; `//host`
 * stays for Better Auth to refuse. `pinFailedRedirectToFrontend` (after) rewrites a
 * Location that is not a front origin. Dropping either reopens one dead-end class.
 */

import type { GenericEndpointContext } from 'better-auth';

import { reportIssueBackend } from '@app/debugger/error-handler';

import {
  isFrontendOrigin,
  pinRedirectToFrontendOrigin,
  resolveCanonicalFrontendOrigin,
} from './auth-token-bridge';
import { getDispatchResponseHeaders } from './better-auth-dispatch-context';

const REDIRECT_TARGET_FIELDS = [
  'callbackURL',
  'errorCallbackURL',
  'newUserCallbackURL',
] as const;

/** Endpoints that take the targets in the JSON body. */
const BODY_TARGET_PATHS = [
  '/sign-in/social',
  '/sign-in/magic-link',
  '/link-social',
] as const;

/** The magic-link verify takes them in the query (the e-mailed link). */
const MAGIC_LINK_VERIFY_PATH = '/magic-link/verify';

/** Endpoints whose 302 a browser follows after the sign-in round trip. */
const isRedirectingAuthPath = (path: string): boolean =>
  path.startsWith('/callback/') || path.startsWith(MAGIC_LINK_VERIFY_PATH);

/** Relative and same-origin only: `/x` yes, `//host`, `/\host`, `http://…` no. */
const isSafeRelativePath = (value: string): boolean =>
  value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\');

const originOf = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  try {
    const { origin } = new URL(value);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
};

/**
 * The front origin this sign-in started on: the request's Origin (the SPA's
 * XHR) or Referer when it is an allowed front origin, so dev on a LAN IP keeps
 * its host; otherwise (a top-level GET from a mail client) the canonical one.
 */
export const resolveRequestFrontendOrigin = (
  headers: Headers | undefined
): string => {
  for (const candidate of [
    originOf(headers?.get('origin')),
    originOf(headers?.get('referer')),
  ]) {
    if (candidate && isFrontendOrigin(candidate)) {
      return candidate;
    }
  }
  return new URL(resolveCanonicalFrontendOrigin()).origin;
};

/** A relative safe target made absolute on `frontOrigin`; anything else as is. */
export const absolutizeRedirectTarget = (
  value: unknown,
  frontOrigin: string
): unknown =>
  typeof value === 'string' && isSafeRelativePath(value)
    ? `${frontOrigin}${value}`
    : value;

type TargetRecord = Record<string, unknown>;

const rewriteTargets = (
  source: TargetRecord,
  frontOrigin: string,
  encode: boolean
): TargetRecord | null => {
  let changed = false;
  const next: TargetRecord = { ...source };
  for (const field of REDIRECT_TARGET_FIELDS) {
    const value = source[field];
    if (typeof value !== 'string' || value === '') {
      continue;
    }
    const absolute = absolutizeRedirectTarget(value, frontOrigin);
    const rewritten =
      encode && typeof absolute === 'string'
        ? encodeURIComponent(absolute)
        : absolute;
    if (rewritten !== value) {
      next[field] = rewritten;
      changed = true;
    }
  }
  return changed ? next : null;
};

const asRecord = (value: unknown): TargetRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as TargetRecord)
    : null;

/**
 * hooks.before: the replacement body / query for the sign-in endpoints, or
 * null when nothing needs to change. Better Auth merges a returned
 * `{ context: { body | query } }` into the endpoint context before its own
 * origin check and handler run (dist/api/dispatch.mjs runBeforeHooks).
 *
 * DECISION: on `/magic-link/verify` every target is also re-encoded. The
 * plugin calls `decodeURIComponent` on query values the URL parser has already
 * decoded, so a `from` inside the error URL (`?from=%2Fapp%3Fx%3D1%26y%3D2`)
 * lost its `&` and a stray `%` threw. One extra encoding makes the plugin's
 * second decode land on the exact value. The real-handler test in
 * auth-redirect-targets.test.ts fails if a release stops decoding twice.
 */
export const normalizeAuthRedirectTargets = (
  ctx: GenericEndpointContext
): { context: { body: TargetRecord } | { query: TargetRecord } } | null => {
  const path = ctx.path ?? '';
  const headers: Headers | undefined =
    ctx.request?.headers ?? ctx.headers ?? undefined;

  if (BODY_TARGET_PATHS.some(prefix => path === prefix)) {
    const body = asRecord(ctx.body);
    if (!body) {
      return null;
    }
    const next = rewriteTargets(
      body,
      resolveRequestFrontendOrigin(headers),
      false
    );
    return next ? { context: { body: next } } : null;
  }

  if (path === MAGIC_LINK_VERIFY_PATH) {
    const query = asRecord(ctx.query);
    if (!query) {
      return null;
    }
    const next = rewriteTargets(
      query,
      resolveRequestFrontendOrigin(headers),
      true
    );
    return next ? { context: { query: next } } : null;
  }

  return null;
};

/**
 * hooks.after net: when a redirecting auth endpoint is about to send the
 * browser to a non-front origin, move the redirect onto the canonical front
 * origin (path + query kept). Call only when the login bridge did not already
 * rewrite the Location (a fresh session), see better-auth.config.ts.
 */
export const pinFailedRedirectToFrontend = (
  ctx: GenericEndpointContext
): void => {
  const path = ctx.path ?? '';
  if (!isRedirectingAuthPath(path)) {
    return;
  }
  const location = getDispatchResponseHeaders(ctx)?.get('location') ?? null;
  if (!location) {
    return;
  }
  const pinned = pinRedirectToFrontendOrigin(location);
  if (pinned === location) {
    return;
  }
  ctx.setHeader('location', pinned);
  // A relative target still reached Better Auth: an old bundle or an old
  // e-mail. Worth seeing while those age out; no URL logged (it may carry a
  // first-touch tag), only the path class.
  reportIssueBackend({
    namespace: 'AUTH_REDIRECT_ORIGIN_NET',
    message: `auth redirect moved onto the front origin: path=${path}`,
    payload: { path, fromOrigin: originOf(location) },
    mode: 'warn',
  });
};
