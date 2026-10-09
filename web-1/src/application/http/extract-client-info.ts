import type { IncomingHttpHeaders } from 'node:http';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import {
  resolveTrustedClientIp,
  resolveTrustedClientIpFromFetch,
} from './trust-aware-ip';

/**
 * Extract a TRUST-AWARE client IP from standard forwarding headers.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Delegates to `resolveTrustedClientIp` (trust-aware-ip.ts). Historically this
 * took the LEFTMOST `x-forwarded-for` hop, which is fully client-controllable
 * (proxies append to the right) — an attacker could rotate the header to mint
 * unlimited fresh rate-limit/dedup buckets (bypass) or pin a victim IP
 * (poisoning). It is now the single SSOT IP source for every IP-keyed control
 * (rate limiter, view-dedup, anti-enumeration throttles): platform edge header
 * first (x-vercel-forwarded-for / cf-connecting-ip), else XFF resolved by
 * TRUSTED_PROXY_DEPTH (rightmost-minus-trusted-hops). Never trust leftmost XFF.
 * Returns `null` when no trusted source is present; callers fall back to
 * `req.socket.remoteAddress`.
 */
export const extractIpFromNodeHeaders = (
  headers: IncomingHttpHeaders
): string | null => resolveTrustedClientIp(headers);

/** Variant operating on Fetch API `Headers` (used by Better Auth hooks). */
export const extractIpFromFetchHeaders = (headers: Headers): string | null =>
  resolveTrustedClientIpFromFetch(headers);

/** Extract user-agent string (null if absent or non-string). */
export const extractUserAgentFromNodeHeaders = (
  headers: IncomingHttpHeaders
): string | null => {
  const ua = headers['user-agent'];
  return typeof ua === 'string' && ua ? ua : null;
};

/**
 * Derive the UI locale of the calling frontend from the custom `pathname`
 * header (sent on every v1 request by the frontend `requestHeadersSetter`).
 * The first path segment is the next-intl locale prefix
 * (`/en/for-stylists` -> 'en'). Unknown / missing segment (default-locale
 * paths, non-browser callers) falls back to the kernel default locale.
 */
export const extractLocaleFromNodeHeaders = (
  headers: IncomingHttpHeaders
): LocaleType => {
  const pathnameHeader = headers[CUSTOM_HEADERS.pathname];
  const pathname =
    typeof pathnameHeader === 'string' ? pathnameHeader : undefined;
  const firstSegment = pathname?.split('/').find(segment => segment !== '');
  return getLocaleOrDefault(firstSegment);
};

/**
 * Bundle: IP + user-agent from Node request headers in a single call.
 * Preferred for call-sites that need both (dev-login, impersonation).
 */
export const getClientInfoFromReq = (
  headers: IncomingHttpHeaders
): { ip: string | null; userAgent: string | null } => ({
  ip: extractIpFromNodeHeaders(headers),
  userAgent: extractUserAgentFromNodeHeaders(headers),
});
