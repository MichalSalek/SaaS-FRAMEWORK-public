/**
 * Apple Sign In — client_secret JWT signer with TTL-based auto-refresh.
 *
 * Apple does not accept a static client secret. Instead, clients must sign
 * a short-lived JWT (ES256) proving ownership of the developer key. This
 * helper generates that JWT from the components Apple developers configure
 * in their developer portal:
 *
 *   - teamId     → Apple Developer Team ID (iss)
 *   - clientId   → Services ID or App ID bundle (sub)
 *   - keyId      → Key ID of the uploaded p8 private key (kid header)
 *   - privateKey → PKCS#8 PEM of the p8 private key
 *
 * Apple caps the client_secret lifetime at 6 months; we use 180 days.
 *
 * ## Refresh mechanism (A16)
 *
 * The JWT is cached in memory with its expiry timestamp. On each call to
 * `getOrRefreshAppleClientSecret()`, the cached token is returned unless it
 * is within 30 days of expiry — at which point a fresh JWT is generated
 * automatically. This prevents the silent 6-month expiry cliff that would
 * otherwise break Apple Sign-In for long-running deployments without
 * process restarts.
 *
 * Used by `better-auth.config.ts`:
 *   - `generateAppleClientSecret()` for the initial top-level await
 *   - `getOrRefreshAppleClientSecret()` in the `hooks.before` middleware
 *     to keep the cached secret fresh on Apple OAuth callback paths
 */

import { importPKCS8, SignJWT } from 'jose';

interface AppleClientSecretInput {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SIX_MONTHS_SECONDS = 60 * 60 * 24 * 180;
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

// ---------------------------------------------------------------------------
// In-memory cache — module-scoped singleton.
// ---------------------------------------------------------------------------
let cachedSecret: string | null = null;
let cachedExpiresAt = 0; // Unix epoch seconds
let cachedInput: AppleClientSecretInput | null = null;

/**
 * Generate a fresh Apple client_secret JWT (ES256, 180-day lifetime).
 *
 * Prefer `getOrRefreshAppleClientSecret()` at runtime — it wraps this
 * function with TTL-based caching so the JWT is only regenerated when
 * approaching expiry.
 */
export async function generateAppleClientSecret(
  input: AppleClientSecretInput
): Promise<string> {
  const key = await importPKCS8(input.privateKey, 'ES256');
  const now = Math.floor(Date.now() / 1000);

  const secret = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: input.keyId })
    .setIssuer(input.teamId)
    .setIssuedAt(now)
    .setExpirationTime(now + SIX_MONTHS_SECONDS)
    .setAudience('https://appleid.apple.com')
    .setSubject(input.clientId)
    .sign(key);

  // Populate the cache so subsequent `getOrRefreshAppleClientSecret` calls
  // reuse the same token without re-signing.
  cachedSecret = secret;
  cachedExpiresAt = now + SIX_MONTHS_SECONDS;
  cachedInput = input;

  return secret;
}

/**
 * Return the cached Apple client_secret, regenerating if it expires within
 * 30 days.
 *
 * Must be called AFTER the initial `generateAppleClientSecret()` that seeds
 * the cache (the top-level await in `better-auth.config.ts` handles this).
 * Returns `null` if the cache was never populated (Apple provider disabled).
 */
export async function getOrRefreshAppleClientSecret(): Promise<string | null> {
  if (!cachedSecret || !cachedInput) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const remainingSeconds = cachedExpiresAt - now;

  if (remainingSeconds > THIRTY_DAYS_SECONDS) {
    return cachedSecret;
  }

  // Token expires within 30 days — regenerate.
  return await generateAppleClientSecret(cachedInput);
}
