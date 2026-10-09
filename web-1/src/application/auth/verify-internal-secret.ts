import { timingSafeEqual } from 'node:crypto';
import { ENV_VARS } from '@app/environment/environment.config';

/**
 * Timing-safe verification of the internal S2S shared secret (BDX W1.4).
 *
 * SSOT for `x-internal-secret` header checks. Consolidates two formerly-duplicated
 * inline implementations:
 *   - dev-login `checkInternalSecret` (defense-in-depth admin-mint lock)
 *   - track-crawler inline secret compare (S2S analytics auth)
 *
 * SECURITY CONTRACT (do NOT weaken):
 *   - Reads the expected secret from ENV_VARS.INTERNAL_SHARED_SECRET (governed via
 *     the env-schema registry; normalized to '' when unset).
 *   - Length pre-check is constant-time on the JS side AND prevents the
 *     timingSafeEqual length-mismatch throw.
 *   - The actual byte compare is `crypto.timingSafeEqual` (constant-time — no
 *     early-exit oracle that would let an attacker recover the secret char-by-char).
 *   - Raw `===`/`!==` on the secret is FORBIDDEN (secret-discipline ratchet).
 *
 * RETURN: `true` only when a non-empty secret is configured AND the provided
 * header matches it byte-for-byte. Returns `false` for:
 *   - no secret configured (expected === '') — callers decide the fail-closed/open
 *     policy (dev-login: graceful-allow in dev; track-crawler: 503 in prod / 204 in dev).
 *     This helper does NOT encode that policy; it only answers "does the header match?".
 *   - missing / non-string / wrong-length / wrong-value header.
 *
 * @param headerValue raw `req.headers['x-internal-secret']` (string | string[] | undefined).
 * @returns whether the header matches the configured secret (timing-safe).
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
