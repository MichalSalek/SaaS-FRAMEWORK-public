import { timingSafeEqual } from 'node:crypto';
import { ENV_VARS } from '@app/environment/environment.config';

/**
 * Timing-safe check of `x-internal-secret` (dev-login, track-crawler).
 * DECISION: compare with `crypto.timingSafeEqual` after a length pre-check (the API throws
 * on a length mismatch). Raw `===` on the secret is forbidden. Returns true only when a
 * non-empty ENV secret matches byte for byte. False when unset, missing or wrong; callers
 * choose fail-open in dev or fail-closed in prod.
 */
export const verifyInternalSecret = (
  headerValue: string | string[] | undefined
): boolean => {
  const expectedSecret = ENV_VARS.INTERNAL_SHARED_SECRET;

  // No secret configured → never a "match" (caller owns the fail-closed/open policy).
  if (!expectedSecret) {
    return false;
  }

  const providedSecret = Array.isArray(headerValue)
    ? headerValue[0]
    : headerValue;
  if (typeof providedSecret !== 'string') {
    return false;
  }

  const providedBuf = Buffer.from(providedSecret);
  const expectedBuf = Buffer.from(expectedSecret);

  // Length pre-check: constant-time on the JS side; prevents the timingSafeEqual
  // length-mismatch throw. Mismatched length is treated identically to a bad value.
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
};

/**
 * True when an internal shared secret is configured at all (non-empty).
 *
 * Lets callers distinguish "no secret configured" (a deploy-config state requiring
 * a fail-closed/open *policy* decision) from "secret configured but header wrong"
 * (an auth failure). `verifyInternalSecret` returns `false` for both; this exposes
 * the former so dev-login can graceful-allow in dev and track-crawler can 503 in prod.
 */
export const isInternalSecretConfigured = (): boolean =>
  ENV_VARS.INTERNAL_SHARED_SECRET.length > 0;
