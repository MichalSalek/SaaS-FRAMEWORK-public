/**
 * Cloudflare Turnstile — konfiguracja frontowa (anty-spam formularzy publicznych).
 *
 * Feature-flag BY PRESENCE (para z backendem, wzór RESEND_MARKETING_*):
 *  - front: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (build-time, klucz PUBLICZNY) —
 *    brak = widget się nie renderuje i token nie jest wysyłany,
 *  - backend (web-1): `TURNSTILE_SECRET_KEY` — brak = weryfikacja wyłączona.
 * Obie strony ustawione = pełna ochrona; obie puste (dev domyślnie) = zero tarcia.
 * Dev/e2e: klucz testowy Cloudflare `1x00000000000000000000AA` (always-pass).
 *
 * Widget utworzony przez CF API 2026-07-16 (konto NF, domena nailfolio.app,
 * mode: managed). Sekret żyje TYLKO na Render (env web-1).
 */
export const TURNSTILE_CONFIG = {
  SITE_KEY: (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim(),
} as const;

export const isTurnstileEnabled = (): boolean =>
  TURNSTILE_CONFIG.SITE_KEY.length > 0;
