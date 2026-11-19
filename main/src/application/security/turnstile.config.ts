/**
 * Cloudflare Turnstile: frontend config (anti-spam for public forms).
 *
 * Feature flag BY PRESENCE (paired with the backend, like RESEND_MARKETING_*):
 *  - front: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (build-time, PUBLIC key); absent = the widget does not
 *    render and no token is sent,
 *  - backend (web-1): `TURNSTILE_SECRET_KEY`; absent = verification off.
 * Both set = full protection; both empty (dev default) = zero friction.
 * Dev/e2e: Cloudflare test key `1x00000000000000000000AA` (always passes).
 *
 * Widget created via the CF API (NF account, domain nailfolio.app, mode: managed). The secret lives
 * ONLY on Render (web-1 env).
 */
export const TURNSTILE_CONFIG = {
  SITE_KEY: (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim(),
} as const;

export const isTurnstileEnabled = (): boolean =>
  TURNSTILE_CONFIG.SITE_KEY.length > 0;
